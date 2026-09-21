const mongoose = require("mongoose");
const FollowUp = require("../models/Followup");
const Lead = require("../models/Lead");

exports.createFollowUp = async (req, res) => {
  try {
    const { leadId, note, date } = req.body;
    if (!leadId) {
      return res.status(400).json({ msg: "leadId is required to create a follow-up" });
    }
    if (!mongoose.isValidObjectId(leadId)) {
      return res.status(400).json({ msg: "Invalid lead ID format" });
    }

    let followUpDate;
    if (date) {
      followUpDate = new Date(date);
      if (!Number.isFinite(followUpDate.getTime())) {
        return res.status(400).json({ msg: "Invalid follow-up date" });
      }
    } else {
      const now = new Date();
      const istOffset = 5.5 * 60 * 60000;
      const tomorrowIST = new Date(now.getTime() + istOffset);
      tomorrowIST.setUTCDate(tomorrowIST.getUTCDate() + 1);
      tomorrowIST.setUTCHours(4, 30, 0, 0);
      followUpDate = tomorrowIST;
    }

    const userId = req.user?._id || req.user?.id;
    const companyId = req.user?.company?._id || req.user?.company || req.user?.companyId;

    if (Lead && typeof Lead.findById === "function") {
      try {
        const lead = await Lead.findById(leadId);
        if (lead) {
          if (companyId && lead.company && String(lead.company) !== String(companyId)) {
            return res.status(403).json({ msg: "Access denied to lead from another company" });
          }
          const role = String(req.user?.role || req.user?.companyRole || "").toLowerCase();
          if (role === "telecaller" && lead.assignedTo && String(lead.assignedTo) !== String(userId)) {
            return res.status(403).json({ msg: "You can only create follow-ups for leads assigned to you" });
          }

          if (!lead.nextFollowUp || followUpDate < new Date(lead.nextFollowUp)) {
            lead.nextFollowUp = followUpDate;
            if (["new", "interested"].includes(lead.status)) {
              lead.status = "follow-up";
            }
            if (typeof lead.save === "function") {
              await lead.save();
            }
          }
        }
      } catch (e) {}
    }

    const follow = await FollowUp.create({
      company: companyId,
      lead: leadId,
      agent: userId,
      date: followUpDate,
      note: typeof note === "string" ? note.trim() : "",
      status: "pending"
    });

    const populated = await FollowUp.findById(follow._id).populate("lead", "name phone email");
    res.status(201).json(populated || follow);
  } catch (err) {
    res.status(400).json({ msg: "Error creating follow-up", error: err.message });
  }
};

exports.getTodayFollowUps = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const companyId = req.user?.company?._id || req.user?.company || req.user?.companyId;
    const now = new Date();
    const istOffset = 5.5 * 60 * 60000;
    const localMidnight = new Date(now.getTime() + istOffset);
    localMidnight.setUTCHours(0, 0, 0, 0);

    const todayIST = new Date(localMidnight.getTime() - istOffset);
    const tomorrowIST = new Date(todayIST);
    tomorrowIST.setDate(todayIST.getDate() + 1);

    const query = {
      agent: userId,
      date: { $gte: todayIST, $lt: tomorrowIST },
      status: "pending"
    };
    if (companyId) query.company = companyId;

    const followUps = await FollowUp.find(query)
      .populate("lead", "name phone email")
      .sort({ date: 1 });

    res.json(followUps);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching follow-ups", error: err.message });
  }
};

exports.getAgentFollowUps = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const companyId = req.user?.company?._id || req.user?.company || req.user?.companyId;

    const query = { agent: userId };
    if (companyId) query.company = companyId;

    const followUps = await FollowUp.find(query)
      .populate("lead", "name phone email")
      .sort({ date: 1 });
    res.json(followUps);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching follow-ups", error: err.message });
  }
};

exports.getLeadFollowUps = async (req, res) => {
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

    const followUps = await FollowUp.find(query)
      .populate("agent", "name email")
      .sort({ date: -1 });
    res.json(followUps);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching lead follow-ups", error: err.message });
  }
};

exports.completeFollowUp = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const companyId = req.user?.company?._id || req.user?.company || req.user?.companyId;
    const role = String(req.user?.role || req.user?.companyRole || "").toLowerCase();

    const query = { _id: req.params.id };
    if (!["admin", "superadmin"].includes(role)) {
      query.agent = userId;
    }
    if (companyId) {
      query.company = companyId;
    }

    let follow = await FollowUp.findOneAndUpdate(query, { status: "done" }, { new: true });
    // In case legacy document didn't have company set, try with agent match only
    if (!follow && !["admin", "superadmin"].includes(role)) {
      follow = await FollowUp.findOneAndUpdate({ _id: req.params.id, agent: userId }, { status: "done" }, { new: true });
    }

    if (!follow) {
      return res.status(404).json({ msg: "Follow-up not found or unauthorized" });
    }

    // Recalculate Lead.nextFollowUp from remaining pending follow-ups
    if (follow.lead && Lead && typeof Lead.updateOne === "function") {
      try {
        let nextDate = null;
        if (typeof FollowUp.findOne === "function") {
          const nextPending = await FollowUp.findOne({
            lead: follow.lead,
            status: "pending",
            date: { $gt: new Date() }
          }).sort({ date: 1 });
          if (nextPending) {
            nextDate = nextPending.date;
          }
        }
        await Lead.updateOne({ _id: follow.lead }, { $set: { nextFollowUp: nextDate } });
      } catch (syncErr) {}
    }

    res.json(follow);
  } catch (err) {
    res.status(400).json({ msg: "Error completing follow-up", error: err.message });
  }
};