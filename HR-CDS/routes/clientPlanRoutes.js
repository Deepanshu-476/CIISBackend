const express = require('express');
const router = express.Router();
const ClientPlan = require('../models/ClientPlan');

const cleanServices = services => (
  Array.isArray(services)
    ? services.map(item => ({
      service: String(item.service || '').trim(),
      tasks: Array.isArray(item.tasks)
        ? item.tasks.map(task => ({
          name: String(task.name || '').trim(),
          description: String(task.description || task.name || '').trim(),
          priority: ['Low', 'Medium', 'High'].includes(task.priority) ? task.priority : 'Medium',
          dueInDays: Number(task.dueInDays || 0)
        })).filter(task => task.name)
        : []
    })).filter(item => item.service)
    : []
);

const buildPayload = body => ({
  companyCode: String(body.companyCode || '').trim().toUpperCase(),
  name: String(body.name || '').trim(),
  price: Number(body.price || 0),
  months: Number(body.months || 1),
  description: String(body.description || '').trim(),
  services: cleanServices(body.services),
  isActive: body.isActive !== false
});

router.get('/', async (req, res) => {
  try {
    const companyCode = String(req.query.companyCode || '').trim().toUpperCase();
    if (!companyCode) return res.status(400).json({ success: false, message: 'Company code is required' });
    const filter = { companyCode };
    if (req.query.includeInactive !== 'true') filter.isActive = true;
    const plans = await ClientPlan.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: plans, plans });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch client plans', error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const payload = buildPayload(req.body);
    if (!payload.companyCode || !payload.name) {
      return res.status(400).json({ success: false, message: 'Company code and plan name are required' });
    }
    if (!payload.services.length) {
      return res.status(400).json({ success: false, message: 'Add at least one service in plan' });
    }
    const plan = await ClientPlan.create(payload);
    res.status(201).json({ success: true, message: 'Client plan created successfully', data: plan, plan });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'Plan name already exists' });
    res.status(500).json({ success: false, message: 'Failed to create client plan', error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const payload = buildPayload(req.body);
    const plan = await ClientPlan.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });
    res.json({ success: true, message: 'Client plan updated successfully', data: plan, plan });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'Plan name already exists' });
    res.status(500).json({ success: false, message: 'Failed to update client plan', error: error.message });
  }
});

module.exports = router;
