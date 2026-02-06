const ClientMeeting = require('../models/ClientMeeting');

// @desc    Get all meetings
// @route   GET /api/cmeeting
// @access  Public
const getMeetings = async (req, res, next) => {
  try {
    const meetings = await ClientMeeting.find({}).sort({ meetingDate: 1, meetingTime: 1 });
    
    res.status(200).json({
      success: true,
      count: meetings.length,
      data: meetings
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single meeting
// @route   GET /api/cmeeting/:id
// @access  Public
const getMeeting = async (req, res, next) => {
  try {
    const meeting = await ClientMeeting.findById(req.params.id);
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        error: 'Meeting not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: meeting
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create meeting
// @route   POST /api/cmeeting/create
// @access  Public
const createMeeting = async (req, res, next) => {
  try {
    const {
      clientName,
      phone,
      email,
      company,
      meetingType,
      priority,
      location,
      meetingDate,
      meetingTime,
      duration,
      description,
      followUpRequired
    } = req.body;

    // Validation
    if (!clientName || !phone || !meetingDate || !meetingTime || !location) {
      return res.status(400).json({
        success: false,
        error: 'Please fill all required fields'
      });
    }

    const meeting = await ClientMeeting.create({
      clientName,
      phone,
      email,
      company,
      meetingType,
      priority,
      location,
      meetingDate,
      meetingTime,
      duration,
      description,
      followUpRequired
    });

    res.status(201).json({
      success: true,
      message: 'Meeting created successfully',
      data: meeting
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update meeting
// @route   PUT /api/cmeeting/:id
// @access  Public
const updateMeeting = async (req, res, next) => {
  try {
    let meeting = await ClientMeeting.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({
        success: false,
        error: 'Meeting not found'
      });
    }

    // Update only provided fields
    const updateData = { ...req.body, updatedAt: Date.now() };
    
    meeting = await ClientMeeting.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: 'Meeting updated successfully',
      data: meeting
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete meeting
// @route   DELETE /api/cmeeting/:id
// @access  Public
const deleteMeeting = async (req, res, next) => {
  try {
    const meeting = await ClientMeeting.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({
        success: false,
        error: 'Meeting not found'
      });
    }

    await meeting.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Meeting deleted successfully',
      data: {}
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get today's meetings
// @route   GET /api/cmeeting/today
// @access  Public
const getTodayMeetings = async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const meetings = await ClientMeeting.find({
      meetingDate: {
        $gte: today,
        $lt: tomorrow
      }
    }).sort({ meetingTime: 1 });

    res.status(200).json({
      success: true,
      count: meetings.length,
      data: meetings
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get meetings by status
// @route   GET /api/cmeeting/status/:status
// @access  Public
const getMeetingsByStatus = async (req, res, next) => {
  try {
    const { status } = req.params;
    const meetings = await ClientMeeting.find({ status }).sort({ meetingDate: -1 });

    res.status(200).json({
      success: true,
      count: meetings.length,
      data: meetings
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update meeting status
// @route   PATCH /api/cmeeting/:id/status
// @access  Public
const updateMeetingStatus = async (req, res, next) => {
  try {
    const { status } = req.body;

    if (!['Scheduled', 'Completed', 'Cancelled', 'Rescheduled'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status value. Must be one of: Scheduled, Completed, Cancelled, Rescheduled'
      });
    }

    const meeting = await ClientMeeting.findByIdAndUpdate(
      req.params.id,
      { status, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );

    if (!meeting) {
      return res.status(404).json({
        success: false,
        error: 'Meeting not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Meeting status updated successfully',
      data: meeting
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get meeting statistics
// @route   GET /api/cmeeting/stats
// @access  Public
const getMeetingStats = async (req, res, next) => {
  try {
    const total = await ClientMeeting.countDocuments();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const todayCount = await ClientMeeting.countDocuments({
      meetingDate: {
        $gte: today,
        $lt: tomorrow
      }
    });

    const highPriority = await ClientMeeting.countDocuments({ priority: 'High' });
    const scheduled = await ClientMeeting.countDocuments({ status: 'Scheduled' });

    // Count by meeting type
    const typeStats = await ClientMeeting.aggregate([
      {
        $group: {
          _id: '$meetingType',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Count by priority
    const priorityStats = await ClientMeeting.aggregate([
      {
        $group: {
          _id: '$priority',
          count: { $sum: 1 }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        total,
        today: todayCount,
        highPriority,
        scheduled,
        typeStats,
        priorityStats
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Search meetings
// @route   GET /api/cmeeting/search
// @access  Public
const searchMeetings = async (req, res, next) => {
  try {
    const { q, type, priority, date } = req.query;
    let query = {};

    // Text search
    if (q) {
      query.$or = [
        { clientName: { $regex: q, $options: 'i' } },
        { company: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } }
      ];
    }

    // Filter by meeting type
    if (type && type !== 'all') {
      query.meetingType = type;
    }

    // Filter by priority
    if (priority && priority !== 'all') {
      query.priority = priority;
    }

    // Filter by date
    if (date) {
      const selectedDate = new Date(date);
      const nextDate = new Date(selectedDate);
      nextDate.setDate(nextDate.getDate() + 1);
      
      query.meetingDate = {
        $gte: selectedDate,
        $lt: nextDate
      };
    }

    const meetings = await ClientMeeting.find(query).sort({ meetingDate: -1 });

    res.status(200).json({
      success: true,
      count: meetings.length,
      data: meetings
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMeetings,
  getMeeting,
  createMeeting,
  updateMeeting,
  deleteMeeting,
  getTodayMeetings,
  getMeetingsByStatus,
  updateMeetingStatus,
  getMeetingStats,
  searchMeetings
};