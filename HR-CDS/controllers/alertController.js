const Alert = require('../models/Alert');

// Get all alerts — Everyone can see
exports.getAlerts = async (req, res) => {
  try {
    const alerts = await Alert.find().sort({ createdAt: -1 });
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Add alert — Admin only
exports.addAlert = async (req, res) => {
  try {
    const { type, message } = req.body;
    if (!type || !message) {
      return res.status(400).json({ message: 'Type and message are required' });
    }
    const newAlert = new Alert({ type, message });
    await newAlert.save();
    res.status(201).json({ message: 'Alert added', alert: newAlert });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Update alert — Admin only
exports.updateAlert = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await Alert.findByIdAndUpdate(id, req.body, { new: true });
    if (!updated) {
      return res.status(404).json({ message: 'Alert not found' });
    }
    res.json({ message: 'Alert updated', alert: updated });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Delete alert — Admin only
exports.deleteAlert = async (req, res) => {
  try {
    const deleted = await Alert.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: 'Alert not found' });
    }
    res.json({ message: 'Alert deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
// controllers/alertsController.js
exports.markAsRead = async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;

  try {
    const alert = await Alert.findById(id);
    if (!alert) return res.status(404).json({ message: 'Alert not found' });

    if (!alert.readBy.includes(userId)) {
      alert.readBy.push(userId);
      await alert.save();
    }

    res.json({ success: true, alert });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};
