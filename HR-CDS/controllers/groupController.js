const Group = require('../models/Group');
const Task = require('../models/Task');
const User = require('../../models/User');

// Create a new group
exports.createGroup = async (req, res) => {
  try {
    const { name, description, members } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    // Check if group name already exists for this user
    const existingGroup = await Group.findOne({
      name,
      createdBy: req.user._id,
      isActive: true
    });

    if (existingGroup) {
      return res.status(400).json({ error: 'Group name already exists' });
    }

    // Validate members
    const validMembers = Array.isArray(members) ? members : [];
    if (validMembers.length > 0) {
      const usersExist = await User.find({ 
        _id: { $in: validMembers } 
      }).select('_id');
      
      if (usersExist.length !== validMembers.length) {
        return res.status(400).json({ error: 'Some users do not exist' });
      }
    }

    const group = await Group.create({
      name,
      description,
      members: validMembers,
      createdBy: req.user._id
    });

    // Populate member details for response
    await group.populate('members', 'name role email');

    res.status(201).json({
      success: true,
      message: 'Group created successfully',
      group
    });

  } catch (error) {
    console.error('❌ Error creating group:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get all groups for the current user
exports.getGroups = async (req, res) => {
  try {
    const groups = await Group.find({
      createdBy: req.user._id,
      isActive: true
    })
    .populate('members', 'name role email')
    .sort({ createdAt: -1 });

    res.json({
      success: true,
      groups
    });

  } catch (error) {
    console.error('❌ Error fetching groups:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get group by ID
exports.getGroupById = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await Group.findOne({
      _id: groupId,
      createdBy: req.user._id,
      isActive: true
    }).populate('members', 'name role email');

    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json({
      success: true,
      group
    });

  } catch (error) {
    console.error('❌ Error fetching group:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Update group
exports.updateGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { name, description, members } = req.body;

    const group = await Group.findOne({
      _id: groupId,
      createdBy: req.user._id,
      isActive: true
    });

    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Check if group name already exists (excluding current group)
    if (name && name !== group.name) {
      const existingGroup = await Group.findOne({
        name,
        createdBy: req.user._id,
        isActive: true,
        _id: { $ne: groupId }
      });

      if (existingGroup) {
        return res.status(400).json({ error: 'Group name already exists' });
      }
    }

    // Validate members if provided
    if (members && Array.isArray(members)) {
      const usersExist = await User.find({ 
        _id: { $in: members } 
      }).select('_id');
      
      if (usersExist.length !== members.length) {
        return res.status(400).json({ error: 'Some users do not exist' });
      }
    }

    // Update group
    if (name) group.name = name;
    if (description !== undefined) group.description = description;
    if (members !== undefined) group.members = members;

    await group.save();
    await group.populate('members', 'name role email');

    res.json({
      success: true,
      message: 'Group updated successfully',
      group
    });

  } catch (error) {
    console.error('❌ Error updating group:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Delete group (soft delete)
exports.deleteGroup = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await Group.findOne({
      _id: groupId,
      createdBy: req.user._id,
      isActive: true
    });

    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Check if group is used in any tasks
    const tasksWithGroup = await Task.findOne({
      assignedGroups: groupId,
      createdBy: req.user._id
      
    });

    if (tasksWithGroup) {
      return res.status(400).json({ 
        error: 'Cannot delete group. It is assigned to one or more tasks.' 
      });
    }

    // Soft delete
    group.isActive = false;
    await group.save();

    res.json({
      success: true,
      message: 'Group deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting group:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Add members to group
exports.addMembersToGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { members } = req.body;

    if (!members || !Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ error: 'Members array is required' });
    }

    const group = await Group.findOne({
      _id: groupId,
      createdBy: req.user._id,
      isActive: true
    });

    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Validate new members
    const usersExist = await User.find({ 
      _id: { $in: members } 
    }).select('_id');
    
    if (usersExist.length !== members.length) {
      return res.status(400).json({ error: 'Some users do not exist' });
    }

    // Add new members (avoid duplicates)
    const newMembers = members.filter(memberId => 
      !group.members.includes(memberId)
    );
    
    if (newMembers.length === 0) {
      return res.status(400).json({ error: 'All users are already members of this group' });
    }

    group.members.push(...newMembers);
    await group.save();
    await group.populate('members', 'name role email');

    res.json({
      success: true,
      message: 'Members added successfully',
      group
    });

  } catch (error) {
    console.error('❌ Error adding members to group:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Remove member from group
exports.removeMemberFromGroup = async (req, res) => {
  try {
    const { groupId, userId } = req.params;

    const group = await Group.findOne({
      _id: groupId,
      createdBy: req.user._id,
      isActive: true
    });

    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Check if user is a member
    const memberIndex = group.members.indexOf(userId);
    if (memberIndex === -1) {
      return res.status(400).json({ error: 'User is not a member of this group' });
    }

    // Remove member
    group.members.splice(memberIndex, 1);
    await group.save();
    await group.populate('members', 'name role email');

    res.json({
      success: true,
      message: 'Member removed successfully',
      group
    });

  } catch (error) {
    console.error('❌ Error removing member from group:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get groups available for task assignment
exports.getAssignableGroups = async (req, res) => {
  try {
    const groups = await Group.find({
      createdBy: req.user._id,
      isActive: true,
      'members.0': { $exists: true } // Only groups with at least one member
    })
    .populate('members', 'name role')
    .select('name description members')
    .sort({ name: 1 });

    res.json({
      success: true,
      groups
    });

  } catch (error) {
    console.error('❌ Error fetching assignable groups:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
console.log("✅ groupController.js loaded successfully");