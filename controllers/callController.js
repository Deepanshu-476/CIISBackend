const CallLog = require("../models/CallLog");

exports.startCall = async (req, res) => {
  try {
    const { leadId } = req.body;
    const call = await CallLog.create({
      lead: leadId,
      agent: req.user.id,
      startTime: new Date(),
    });
    res.status(201).json(call);
  } catch (err) {
    res.status(400).json({ msg: "Call start failed", error: err.message });
  }
};

exports.endCall = async (req, res) => {
  try {
    const { callId, status, notes } = req.body;
    const call = await CallLog.findById(callId);
    call.endTime = new Date();
    call.duration = Math.floor((call.endTime - call.startTime) / 1000); // in seconds
    call.status = status;
    call.notes = notes;
    await call.save();
    res.json(call);
  } catch (err) {
    res.status(400).json({ msg: "Call end failed", error: err.message });
  }
};

exports.getAgentCalls = async (req, res) => {
  try {
    const calls = await CallLog.find({ agent: req.user.id }).populate("lead", "name phone");
    res.json(calls);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching call logs", error: err.message });
  }
};
