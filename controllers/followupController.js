const mongoose = require("mongoose");
const FollowUp = require("../models/Followup");
const Lead = require("../models/Lead");

const privilegedRoles = new Set(["admin", "superadmin", "companyadmin", "company admin"]);
const getUserId = req => req.user?._id || req.user?.id;
const getCompanyId = req => req.user?.company?._id || req.user?.company || req.user?.companyId;
const getRole = req => String(req.user?.role || req.user?.companyRole || "").toLowerCase();

const syncLeadNextFollowUp = async (leadId, companyId) => {
  const pendingQuery = { lead: leadId, status: "pending", date: { $gt: new Date() } };
  if (companyId) pendingQuery.company = companyId;
  const nextPending = await FollowUp.findOne(pendingQuery).sort({ date: 1 });
  const leadQuery = { _id: leadId };
  if (companyId) leadQuery.company = companyId;
  await Lead.updateOne(leadQuery, { $set: { nextFollowUp: nextPending?.date || null } });
};

exports.createFollowUp = async (req, res) => {
  try {
    const { leadId, note, date, priority = "medium" } = req.body;
    if (!leadId) return res.status(400).json({ msg: "leadId is required to create a follow-up" });
    if (!mongoose.isValidObjectId(leadId)) return res.status(400).json({ msg: "Invalid lead ID format" });

    let followUpDate;
    if (date) {
      followUpDate = new Date(date);
      if (!Number.isFinite(followUpDate.getTime())) return res.status(400).json({ msg: "Invalid follow-up date" });
    } else {
      const now = new Date();
      const istOffset = 5.5 * 60 * 60000;
      const tomorrowIST = new Date(now.getTime() + istOffset);
      tomorrowIST.setUTCDate(tomorrowIST.getUTCDate() + 1);
      tomorrowIST.setUTCHours(4, 30, 0, 0);
      followUpDate = tomorrowIST;
    }

    const normalizedPriority = String(priority).trim().toLowerCase();
    if (!["low", "medium", "high"].includes(normalizedPriority)) {
      return res.status(400).json({ msg: "Priority must be low, medium, or high" });
    }

    const userId = getUserId(req);
    const companyId = getCompanyId(req);
    const lead = await Lead.findById(leadId);
    if (!lead) return res.status(404).json({ msg: "Lead not found" });
    if (companyId && (!lead.company || String(lead.company) !== String(companyId))) {
      return res.status(403).json({ msg: "Access denied to lead from another company" });
    }
    if (getRole(req) === "telecaller" && String(lead.assignedTo || "") !== String(userId)) {
      return res.status(403).json({ msg: "You can only create follow-ups for leads assigned to you" });
    }

    if (!lead.nextFollowUp || followUpDate < new Date(lead.nextFollowUp)) {
      lead.nextFollowUp = followUpDate;
      if (["new", "interested"].includes(lead.status)) lead.status = "follow-up";
      await lead.save();
    }

    const follow = await FollowUp.create({
      company: companyId,
      lead: leadId,
      agent: userId,
      date: followUpDate,
      note: typeof note === "string" ? note.trim() : "",
      priority: normalizedPriority,
      status: "pending"
    });
    const populated = await FollowUp.findById(follow._id).populate("lead", "name phone email");
    return res.status(201).json(populated || follow);
  } catch (err) {
    return res.status(400).json({ msg: "Error creating follow-up", error: err.message });
  }
};

exports.getTodayFollowUps = async (req, res) => {
  try {
    const userId = getUserId(req);
    const companyId = getCompanyId(req);
    const now = new Date();
    const istOffset = 5.5 * 60 * 60000;
    const localMidnight = new Date(now.getTime() + istOffset);
    localMidnight.setUTCHours(0, 0, 0, 0);
    const todayIST = new Date(localMidnight.getTime() - istOffset);
    const tomorrowIST = new Date(todayIST.getTime() + 24 * 60 * 60000);
    const query = { agent: userId, date: { $gte: todayIST, $lt: tomorrowIST }, status: "pending" };
    if (companyId) query.company = companyId;
    const followUps = await FollowUp.find(query).populate("lead", "name phone email").sort({ date: 1 });
    return res.json(followUps);
  } catch (err) {
    return res.status(500).json({ msg: "Error fetching follow-ups", error: err.message });
  }
};

exports.getAgentFollowUps = async (req, res) => {
  try {
    const query = { agent: getUserId(req) };
    const companyId = getCompanyId(req);
    if (companyId) query.company = companyId;
    const followUps = await FollowUp.find(query).populate("lead", "name phone email").sort({ date: 1 });
    return res.json(followUps);
  } catch (err) {
    return res.status(500).json({ msg: "Error fetching follow-ups", error: err.message });
  }
};

exports.getLeadFollowUps = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.leadId)) return res.status(400).json({ msg: "Invalid lead ID format" });
    const companyId = getCompanyId(req);
    const lead = await Lead.findById(req.params.leadId).lean();
    if (!lead) return res.status(404).json({ msg: "Lead not found" });
    if (companyId && (!lead.company || String(lead.company) !== String(companyId))) return res.status(403).json({ msg: "Access denied" });
    const query = { lead: req.params.leadId };
    if (companyId) query.company = companyId;
    const followUps = await FollowUp.find(query).populate("agent", "name email").sort({ date: -1 });
    return res.json(followUps);
  } catch (err) {
    return res.status(500).json({ msg: "Error fetching lead follow-ups", error: err.message });
  }
};

exports.updateFollowUp = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ msg: "Invalid follow-up ID format" });
    const companyId = getCompanyId(req);
    const query = { _id: req.params.id };
    if (companyId) query.company = companyId;
    if (!privilegedRoles.has(getRole(req))) query.agent = getUserId(req);

    const updates = {};
    if (Object.prototype.hasOwnProperty.call(req.body, "date")) {
      const date = new Date(req.body.date);
      if (!Number.isFinite(date.getTime())) return res.status(400).json({ msg: "Invalid follow-up date" });
      updates.date = date;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "priority")) {
      const priority = String(req.body.priority).trim().toLowerCase();
      if (!["low", "medium", "high"].includes(priority)) return res.status(400).json({ msg: "Priority must be low, medium, or high" });
      updates.priority = priority;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "note")) updates.note = String(req.body.note || "").trim().slice(0, 5000);
    if (!Object.keys(updates).length) return res.status(400).json({ msg: "No editable follow-up fields supplied" });

    const follow = await FollowUp.findOneAndUpdate(query, { $set: updates }, { new: true, runValidators: true })
      .populate("lead", "name phone email")
      .populate("agent", "name email");
    if (!follow) return res.status(404).json({ msg: "Follow-up not found or unauthorized" });
    if (follow.lead) await syncLeadNextFollowUp(follow.lead._id || follow.lead, companyId);
    return res.json(follow);
  } catch (err) {
    return res.status(500).json({ msg: "Error updating follow-up", error: err.message });
  }
};

exports.completeFollowUp = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ msg: "Invalid follow-up ID format" });
    const companyId = getCompanyId(req);
    const query = { _id: req.params.id };
    if (!privilegedRoles.has(getRole(req))) query.agent = getUserId(req);
    if (companyId) query.company = companyId;
    const follow = await FollowUp.findOneAndUpdate(query, { status: "done" }, { new: true });
    if (!follow) return res.status(404).json({ msg: "Follow-up not found or unauthorized" });
    if (follow.lead) await syncLeadNextFollowUp(follow.lead, companyId);
    return res.json(follow);
  } catch (err) {
    return res.status(500).json({ msg: "Error completing follow-up", error: err.message });
  }
};
