const Lead = require("../models/Lead");
const { getPaginationOptions } = require("../utils/pagination");

const applyListOptions = (query, { skip, limit }) => {
  let next = query;
  if (typeof next.skip === "function") next = next.skip(skip);
  if (typeof next.limit === "function") next = next.limit(limit);
  if (typeof next.lean === "function") next = next.lean();
  return next;
};

const setPaginationHeaders = async (res, model, filter, { page, limit }) => {
  if (typeof res.set !== "function" || typeof model.countDocuments !== "function") return;
  const total = await model.countDocuments(filter);
  res.set("X-Total-Count", String(total));
  res.set("X-Page", String(page));
  res.set("X-Limit", String(limit));
};

exports.createLead = async (req, res) => {
  try {
    const lead = await Lead.create({ ...req.body, createdBy: req.user.id });
    res.status(201).json(lead);
  } catch (err) {
    res.status(400).json({ msg: "Error creating lead", error: err.message });
  }
};

exports.getLeads = async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.user.role === "agent") filter.assignedTo = req.user.id;

  try {
    const { page, limit, skip } = getPaginationOptions(req.query || {}, { limit: 50, maxLimit: 100 });
    const query = Lead.find(filter).populate("assignedTo", "name email").sort({ createdAt: -1, _id: -1 });
    const leads = await applyListOptions(query, { skip, limit });
    await setPaginationHeaders(res, Lead, filter, { page, limit });
    res.json(leads);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching leads", error: err.message });
  }
};

exports.updateLead = async (req, res) => {
  try {
    const lead = await Lead.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(lead);
  } catch (err) {
    res.status(400).json({ msg: "Error updating lead", error: err.message });
  }
};

exports.assignLead = async (req, res) => {
  const { userId } = req.body;
  try {
    const lead = await Lead.findByIdAndUpdate(req.params.id, { assignedTo: userId }, { new: true });
    res.json(lead);
  } catch (err) {
    res.status(400).json({ msg: "Assignment failed", error: err.message });
  }
};

exports.addNote = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    lead.notes.push({ message: req.body.message });
    await lead.save();
    res.json(lead);
  } catch (err) {
    res.status(400).json({ msg: "Failed to add note", error: err.message });
  }
};
void 0;
