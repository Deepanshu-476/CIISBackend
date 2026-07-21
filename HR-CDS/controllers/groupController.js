const Group = require('../models/Group');
const Task = require('../models/Task');
const User = require('../../models/User');
const {notifyDirectUsers} = require('../utils/systemNotificationService');
const { getPaginationOptions, buildPaginationMeta } = require('../../utils/pagination');

const getId = value => {
  if (!value) return null;
  if (value._id) return value._id;
  if (value.id) return value.id;
  return value;
};

const getCompanyId = user => getId(user?.company || user?.companyId || user?.companyDetails);
const getCompanyCode = user => user?.companyCode || user?.company?.companyCode || user?.companyDetails?.companyCode || '';

const buildCompanyUserFilter = user => {
  const companyId = getCompanyId(user);
  const companyCode = getCompanyCode(user);
  const filters = [];
  if (companyId) filters.push({company: companyId});
  if (companyCode) filters.push({companyCode});
  return filters.length > 1 ? {$or: filters} : filters[0] || {};
};

const getCompanyUserIds = async user => {
  const filter = buildCompanyUserFilter(user);
  if (!Object.keys(filter).length) return [];
  const users = await User.find(filter).select('_id').lean();
  return users.map(item => item._id);
};

const buildGroupCompanyFilter = async user => {
  const companyId = getCompanyId(user);
  const companyCode = getCompanyCode(user);
  const companyUserIds = await getCompanyUserIds(user);
  const filters = [];
  if (companyId) filters.push({company: companyId});
  if (companyCode) filters.push({companyCode});
  if (companyUserIds.length) {
    filters.push({
      company: {$exists: false},
      companyCode: {$exists: false},
      $or: [
        {createdBy: {$in: companyUserIds}},
        {members: {$in: companyUserIds}},
      ],
    });
  }
  return filters.length ? {$or: filters} : {};
};

const mergeQueries = (...queries) => {
  const parts = queries.filter(query => query && Object.keys(query).length);
  if (!parts.length) return {};
  if (parts.length === 1) return parts[0];
  return {$and: parts};
};


exports.createGroup = async (req, res) => {
  try {
    const { name, description, members } = req.body;

    
    if (!name) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    
    const existingGroup = await Group.findOne({
      name,
      createdBy: req.user._id,
      isActive: true
    });

    if (existingGroup) {
      return res.status(400).json({ error: 'Group name already exists' });
    }

    
    const validMembers = Array.isArray(members) ? members : [];
    if (validMembers.length > 0) {
      const usersExist = await User.find({ 
        _id: { $in: validMembers },
        ...buildCompanyUserFilter(req.user),
      }).select('_id');
      
      if (usersExist.length !== validMembers.length) {
        return res.status(400).json({ error: 'Some users do not exist' });
      }
    }

    const uniqueMembers = Array.from(
      new Set([
        ...validMembers.map((id) => id.toString()),
        req.user._id.toString()
      ])
    ).map((id) => id);

    const group = await Group.create({
      name,
      description,
      members: uniqueMembers,
      createdBy: req.user._id,
      company: getCompanyId(req.user),
      companyCode: getCompanyCode(req.user),
    });

    
    await group.populate('members', 'name role email');

    notifyDirectUsers({
      userIds: uniqueMembers.filter(memberId => memberId !== req.user._id.toString()),
      targetPath: '/ciisUser/manage-groups',
      type: 'group_member_added',
      title: 'Added to Group',
      message: `${req.user.name || 'Admin'} added you to group "${name}"`,
      actor: req.user._id,
      company: req.user.company,
      data: {
        groupId: group._id,
        groupName: name,
      },
      priority: 'medium',
    }).catch(error => console.error('Group create notification failed:', error.message));

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


exports.getGroups = async (req, res) => {
  try {
    const { page, limit, skip } = getPaginationOptions(req.query, { limit: 25, maxLimit: 100 });
    const filter = mergeQueries(await buildGroupCompanyFilter(req.user), {
      isActive: true,
      $or: [
        { createdBy: req.user._id },
        { members: req.user._id }
      ]
    });
    const [groups, total] = await Promise.all([
      Group.find(filter)
        .populate('members', 'name role email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Group.countDocuments(filter)
    ]);

    res.json({
      success: true,
      groups,
      count: groups.length,
      total,
      pagination: buildPaginationMeta({ page, limit, total })
    });

  } catch (error) {
    console.error('❌ Error fetching groups:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};


exports.getGroupById = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await Group.findOne({
      _id: groupId,
      isActive: true,
      $or: [
        { createdBy: req.user._id },
        { members: req.user._id }
      ]
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

    
    if (members && Array.isArray(members)) {
      const usersExist = await User.find({ 
        _id: { $in: members } 
      }).select('_id');
      
      if (usersExist.length !== members.length) {
        return res.status(400).json({ error: 'Some users do not exist' });
      }
    }

    const previousMembers = (group.members || []).map(member => member.toString());

    
    if (name) group.name = name;
    if (description !== undefined) group.description = description;
    if (members !== undefined) group.members = members;

    await group.save();
    await group.populate('members', 'name role email');

    const currentMembers = (group.members || []).map(member => member._id?.toString() || member.toString());
    const addedMembers = currentMembers.filter(memberId => !previousMembers.includes(memberId) && memberId !== req.user._id.toString());

    notifyDirectUsers({
      userIds: addedMembers,
      targetPath: '/ciisUser/manage-groups',
      type: 'group_member_added',
      title: 'Added to Group',
      message: `${req.user.name || 'Admin'} added you to group "${group.name}"`,
      actor: req.user._id,
      company: req.user.company,
      data: {
        groupId: group._id,
        groupName: group.name,
      },
      priority: 'medium',
    }).catch(error => console.error('Group update notification failed:', error.message));

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

    
    const tasksWithGroup = await Task.findOne({
      assignedGroups: groupId,
      createdBy: req.user._id
      
    });

    if (tasksWithGroup) {
      return res.status(400).json({ 
        error: 'Cannot delete group. It is assigned to one or more tasks.' 
      });
    }

    
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

    
    const usersExist = await User.find({ 
      _id: { $in: members } 
    }).select('_id');
    
    if (usersExist.length !== members.length) {
      return res.status(400).json({ error: 'Some users do not exist' });
    }

    
    const newMembers = members.filter(memberId => 
      !group.members.includes(memberId)
    );
    
    if (newMembers.length === 0) {
      return res.status(400).json({ error: 'All users are already members of this group' });
    }

    group.members.push(...newMembers);
    await group.save();
    await group.populate('members', 'name role email');

    notifyDirectUsers({
      userIds: newMembers,
      targetPath: '/ciisUser/manage-groups',
      type: 'group_member_added',
      title: 'Added to Group',
      message: `${req.user.name || 'Admin'} added you to group "${group.name}"`,
      actor: req.user._id,
      company: req.user.company,
      data: {
        groupId: group._id,
        groupName: group.name,
      },
      priority: 'medium',
    }).catch(error => console.error('Group add-member notification failed:', error.message));

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

    
    const memberIndex = group.members.indexOf(userId);
    if (memberIndex === -1) {
      return res.status(400).json({ error: 'User is not a member of this group' });
    }

    
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


exports.getAssignableGroups = async (req, res) => {
  try {
    const groups = await Group.find({
      createdBy: req.user._id,
      isActive: true,
      'members.0': { $exists: true } 
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
void 0;
