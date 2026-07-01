const FollowUp = require("../models/Followup");

exports.createFollowUp = async (req, res) => {
  try {
    const { leadId, note } = req.body;

    
    const now = new Date();
    const istOffset = 5.5 * 60 * 60000;
    const tomorrowIST = new Date(now.getTime() + istOffset);
    tomorrowIST.setUTCDate(tomorrowIST.getUTCDate() + 1);
    tomorrowIST.setUTCHours(4, 30, 0, 0); 

    const follow = await FollowUp.create({
      lead: leadId,
      agent: req.user.id,
      date: new Date(tomorrowIST),
      note
    });

    res.status(201).json(follow);
  } catch (err) {
    res.status(400).json({ msg: "Error creating follow-up", error: err.message });
  }
};


exports.getTodayFollowUps = async (req, res) => {
  try {
    const now = new Date();

    
    const istOffset = 5.5 * 60 * 60000; 
    const localMidnight = new Date(now.getTime() + istOffset);
    localMidnight.setUTCHours(0, 0, 0, 0);

    const todayIST = new Date(localMidnight.getTime() - istOffset);
    const tomorrowIST = new Date(todayIST);
    tomorrowIST.setDate(todayIST.getDate() + 1);

    void 0;
    void 0;

    const followUps = await FollowUp.find({
      agent: req.user.id,
      date: { $gte: todayIST, $lt: tomorrowIST },
      status: "pending"
    }).populate("lead", "name phone");

    res.json(followUps);
  } catch (err) {
    res.status(500).json({ msg: "Error fetching follow-ups", error: err.message });
  }
};


exports.completeFollowUp = async (req, res) => {
    try {
        const follow = await FollowUp.findByIdAndUpdate(req.params.id, { status: "done" }, { new: true });
        res.json(follow);
    } catch (err) {
        res.status(400).json({ msg: "Error completing follow-up", error: err.message });
    }
};



void 0;