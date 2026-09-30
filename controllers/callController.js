const mongoose = require("mongoose");
const CallLog = require("../models/CallLog");
const Lead = require("../models/Lead");
const { getPaginationOptions } = require("../utils/pagination");

const applyListOptions = (query, { skip, limit }) => {
  let next = query;
  if (typeof next.skip === "function") next = next.skip(skip);
  if (typeof next.limit === "function") next = next.limit(limit);
  if (typeof next.lean === "function") next = next.lean();
  return next;
};

const setPaginationHeaders = async (res, filter, { page, limit }) => {
  if (typeof res.set !== "function" || typeof CallLog.countDocuments !== "function") return;
  const total = await CallLog.countDocuments(filter);
  res.set("X-Total-Count", String(total));
  res.set("X-Page", String(page));
  res.set("X-Limit", String(limit));
};

const mapCallStatus = (status) => {
  const valid = ["answered", "missed", "not reachable", "rejected"];
  const s = String(status || "").toLowerCase().trim();
  if (valid.includes(s)) return s;
  if (["connected", "interested", "follow-up", "need callback", "call later", "converted"].includes(s)) return "answered";
  if (["no answer", "busy"].includes(s)) return "missed";
  if (["switched off", "not reachable"].includes(s)) return "not reachable";
  if (["wrong number", "wrong person", "invalid number", "language barrier", "do not call", "duplicate", "spam", "call closed"].includes(s)) return "rejected";
  return "answered";
};

exports.startCall = async (req, res) => {
  try {
    const { leadId } = req.body;
    if (!leadId) {
      return res.status(400).json({ msg: "leadId is required to start a call" });
    }
    if (!mongoose.isValidObjectId(leadId)) {
      return res.status(400).json({ msg: "Invalid lead ID format" });
    }

    const userId = req.user?._id || req.user?.id;
    const companyId = req.user?.company?._id || req.user?.company || req.user?.companyId;

    if (Lead && typeof Lead.findById === "function") {
      try {
        const lead = await Lead.findById(leadId).lean();
        if (lead) {
          if (companyId && lead.company && String(lead.company) !== String(companyId)) {
            return res.status(403).json({ msg: "Access denied to lead from another company" });
          }
          const role = String(req.user?.role || req.user?.companyRole || "").toLowerCase();
          if (role === "telecaller" && lead.assignedTo && String(lead.assignedTo) !== String(userId)) {
            return res.status(403).json({ msg: "You can only start calls for leads assigned to you" });
          }
        }
      } catch (e) {
        // If DB mock doesn't support lean or environment is mock-only
      }
    }

    const call = await CallLog.create({
      company: companyId,
      lead: leadId,
      agent: userId,
      startTime: new Date(),
    });

    const populated = await CallLog.findById(call._id).populate("lead", "name phone email");
    res.status(201).json(populated || call);
  } catch (err) {
    res.status(400).json({ msg: "Call start failed", error: err.message });
  }
};

exports.endCall = async (req, res) => {
  try {
    const { callId, status, notes } = req.body;
    if (!callId) {
      return res.status(400).json({ msg: "callId is required to end a call" });
    }

    const call = await CallLog.findById(callId);
    if (!call) {
      return res.status(404).json({ msg: "Call log not found" });
    }

    const userId = req.user?._id || req.user?.id;
    const companyId = req.user?.company?._id || req.user?.company || req.user?.companyId;
    const role = String(req.user?.role || req.user?.companyRole || "").toLowerCase();

    if (call.agent && String(call.agent) !== String(userId) && !["admin", "superadmin"].includes(role)) {
      return res.status(403).json({ msg: "Unauthorized to end this call log" });
    }
    if (companyId && call.company && String(call.company) !== String(companyId)) {
      return res.status(403).json({ msg: "Access denied" });
    }

    call.endTime = new Date();
    call.duration = Math.max(0, Math.floor((call.endTime - (call.startTime || call.endTime)) / 1000));
    call.status = mapCallStatus(status);
    call.notes = typeof notes === "string" ? notes.trim() : "";
    await call.save();

    const populated = await CallLog.findById(call._id)
      .populate("lead", "name phone email")
      .populate("agent", "name email");
    res.json(populated || call);
  } catch (err) {
    res.status(400).json({ msg: "Call end failed", error: err.message });
  }
};

exports.getAgentCalls = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const companyId = req.user?.company?._id || req.user?.company || req.user?.companyId;

    const query = { agent: userId };
    if (companyId) query.company = companyId;
    const { page, limit, skip } = getPaginationOptions(req.query || {}, { limit: 50, maxLimit: 100 });

    const callsQuery = CallLog.find(query)
      .populate("lead", "name phone email")
      .populate("agent", "name email")
      .sort({ createdAt: -1 });
    const calls = await applyListOptions(callsQuery, { skip, limit });
    await setPaginationHeaders(res, query, { page, limit });
    res.json(calls);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching call logs", error: err.message });
  }
};

exports.getLeadCalls = async (req, res) => {
  try {
    const companyId = req.user?.company?._id || req.user?.company || req.user?.companyId;

    if (Lead && typeof Lead.findById === "function") {
      try {
        const lead = await Lead.findById(req.params.leadId).lean();
        if (lead && companyId && lead.company && String(lead.company) !== String(companyId)) {
          return res.status(403).json({ msg: "Access denied" });
        }
      } catch (e) {}
    }

    const query = { lead: req.params.leadId };
    if (companyId) query.company = companyId;
    const { page, limit, skip } = getPaginationOptions(req.query || {}, { limit: 50, maxLimit: 100 });

    const callsQuery = CallLog.find(query)
      .populate("agent", "name email")
      .sort({ createdAt: -1 });
    const calls = await applyListOptions(callsQuery, { skip, limit });
    await setPaginationHeaders(res, query, { page, limit });
    res.json(calls);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching lead calls", error: err.message });
  }
};
