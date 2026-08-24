const mongoose = require('mongoose');
const FeedbackQuestionnaire = require('../models/FeedbackQuestionnaire');
const FeedbackResponse = require('../models/FeedbackResponse');
const User = require('../../models/User');
const Company = require('../../models/Company');
const Branch = require('../../models/Branch');
const { sendSystemNotification } = require('../utils/systemNotificationService');
const { getPaginationOptions, buildPaginationMeta } = require('../../utils/pagination');

const normalizeId = value => {
  if (!value) return '';
  if (typeof value === 'object') return String(value._id || value.id || value.value || '');
  return String(value).trim();
};

const normalizeText = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const isSuperAdmin = user => {
  const role = normalizeText(user?.jobRole || user?.companyRole || user?.role);
  return role === 'super_admin' || role === 'superadmin';
};

const buildQuestionSummary = questionnaire => {
  const scopeLabel = {
    company: 'Company',
    branch: 'Branch',
    user: 'Specific User',
  }[questionnaire.targetScope] || 'Audience';

  return `${scopeLabel} feedback`;
};

const getTargetUsers = async ({ targetScope, companyId, branchId, targetedUsers = [], recipientMode = 'all' }) => {
  const companyObjectId = companyId && mongoose.Types.ObjectId.isValid(companyId) ? companyId : null;
  const branchObjectId = branchId && mongoose.Types.ObjectId.isValid(branchId) ? branchId : null;
  const targetedUserIds = [...new Set((Array.isArray(targetedUsers) ? targetedUsers : [])
    .map(normalizeId)
    .filter(Boolean))];

  if (targetScope === 'user') {
    return targetedUserIds;
  }

  const query = {
    isActive: true,
    companyRole: { $not: /^client$/i },
  };

  if (companyObjectId) {
    query.company = companyObjectId;
  }

  if (targetScope === 'branch' && branchObjectId) {
    query.$or = [
      { branch: branchObjectId },
      { assignedBranches: branchObjectId },
    ];
  }

  const users = await User.find(query).select('_id').lean();
  const allUserIds = users.map(user => String(user._id));

  if (recipientMode === 'specific' && targetedUserIds.length) {
    return allUserIds.filter(userId => targetedUserIds.includes(userId));
  }

  return allUserIds;
};

const sanitizeQuestions = questions => (Array.isArray(questions) ? questions : []).map(question => ({
  label: String(question.label || '').trim(),
  type: String(question.type || 'text').trim(),
  required: Boolean(question.required),
  options: Array.isArray(question.options)
    ? question.options.map(option => String(option || '').trim()).filter(Boolean)
    : [],
  maxRating: Number(question.maxRating || 5),
  placeholder: String(question.placeholder || '').trim(),
})).filter(question => question.label);

const mapQuestionnaire = questionnaire => ({
  ...questionnaire,
  targetSummary: buildQuestionSummary(questionnaire),
  recipientCount: Array.isArray(questionnaire.recipientIds) ? questionnaire.recipientIds.length : questionnaire.recipientCount,
});

exports.createQuestionnaire = async (req, res) => {
  try {
    if (!isSuperAdmin(req.user)) {
      return res.status(403).json({ success: false, message: 'Only Super Admin can create feedback questionnaires' });
    }

    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const targetScope = String(req.body.targetScope || '').trim();
    const recipientMode = String(req.body.recipientMode || 'all').trim();
    const nameVisibility = String(req.body.nameVisibility || 'show_name').trim();
    const company = normalizeId(req.body.company);
    const branch = normalizeId(req.body.branch);
    const targetedUsers = Array.isArray(req.body.targetedUsers) ? req.body.targetedUsers : [];
    const questions = sanitizeQuestions(req.body.questions);

    if (!title) return res.status(400).json({ success: false, message: 'Title is required' });
    if (!['company', 'branch', 'user'].includes(targetScope)) {
      return res.status(400).json({ success: false, message: 'Target scope is invalid' });
    }
    if (!['all', 'specific'].includes(recipientMode)) {
      return res.status(400).json({ success: false, message: 'Recipient mode is invalid' });
    }
    if (!['show_name', 'anonymous'].includes(nameVisibility)) {
      return res.status(400).json({ success: false, message: 'Name visibility is invalid' });
    }
    if (!questions.length) return res.status(400).json({ success: false, message: 'Add at least one question' });

    if (targetScope === 'company' && !company) {
      return res.status(400).json({ success: false, message: 'Company selection is required' });
    }

    if (targetScope === 'branch' && !branch) {
      return res.status(400).json({ success: false, message: 'Branch selection is required' });
    }

    if (targetScope === 'user' && !targetedUsers.length) {
      return res.status(400).json({ success: false, message: 'Select at least one user' });
    }

    if (questions.some(question => ['single_choice', 'multiple_choice'].includes(question.type) && question.options.length < 2)) {
      return res.status(400).json({ success: false, message: 'Choice questions need at least two options' });
    }

    if (targetScope === 'company') {
      const companyExists = await Company.findById(company).select('_id').lean();
      if (!companyExists) return res.status(404).json({ success: false, message: 'Company not found' });
    }

    if (targetScope === 'branch') {
      const branchRecord = await Branch.findById(branch).select('_id company').lean();
      if (!branchRecord) return res.status(404).json({ success: false, message: 'Branch not found' });
      if (company && String(branchRecord.company) !== String(company)) {
        return res.status(400).json({ success: false, message: 'Branch does not belong to selected company' });
      }
    }

    const recipientIds = await getTargetUsers({
      targetScope,
      companyId: company,
      branchId: branch,
      targetedUsers,
      recipientMode,
    });

    if (!recipientIds.length) {
      return res.status(400).json({ success: false, message: 'No recipients found for this questionnaire' });
    }

    const questionnaire = await FeedbackQuestionnaire.create({
      title,
      description,
      targetScope,
      recipientMode,
      company: company || null,
      branch: branch || null,
      targetedUsers: targetedUsers.map(normalizeId).filter(Boolean),
      recipientIds,
      questions,
      nameVisibility,
      status: 'active',
      createdBy: req.user._id,
      sentAt: new Date(),
      metadata: {
        createdFrom: 'super_admin',
      },
    });

    await sendSystemNotification({
      recipients: recipientIds,
      targetPath: '/ciisUser/user-dashboard',
      targetScreen: 'Dashboard',
      type: 'feedback_questionnaire',
      title: `New Feedback: ${questionnaire.title}`,
      message: 'A new feedback questionnaire is waiting for your response.',
      actor: req.user._id,
      company: company || req.user.company || null,
      data: {
        feedbackId: questionnaire._id,
        questionnaireId: questionnaire._id,
        questionnaireTitle: questionnaire.title,
        targetScope: questionnaire.targetScope,
        nameVisibility: questionnaire.nameVisibility,
      },
      priority: 'high',
      push: true,
    });

    return res.status(201).json({
      success: true,
      message: `Questionnaire sent to ${recipientIds.length} user${recipientIds.length === 1 ? '' : 's'}`,
      data: mapQuestionnaire(questionnaire.toObject()),
    });
  } catch (error) {
    console.error('Feedback create error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create questionnaire' });
  }
};

exports.listQuestionnaires = async (req, res) => {
  try {
    if (!isSuperAdmin(req.user)) {
      return res.status(403).json({ success: false, message: 'Only Super Admin can view questionnaires' });
    }

    const { page, limit, skip } = getPaginationOptions(req.query, { limit: 20, maxLimit: 100 });
    const filter = {};

    if (req.query.status) {
      filter.status = String(req.query.status).trim();
    }

    const [items, total] = await Promise.all([
      FeedbackQuestionnaire.find(filter)
        .populate('company', 'companyName companyCode')
        .populate('branch', 'name branchCode')
        .populate('createdBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      FeedbackQuestionnaire.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        questionnaires: items.map(mapQuestionnaire),
        pagination: buildPaginationMeta({ page, limit, total }),
      },
    });
  } catch (error) {
    console.error('Feedback list error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load questionnaires' });
  }
};

exports.getQuestionnaireById = async (req, res) => {
  try {
    if (!isSuperAdmin(req.user)) {
      return res.status(403).json({ success: false, message: 'Only Super Admin can view questionnaires' });
    }

    const questionnaire = await FeedbackQuestionnaire.findById(req.params.id)
      .populate('company', 'companyName companyCode')
      .populate('branch', 'name branchCode')
      .populate('createdBy', 'name email')
      .lean();

    if (!questionnaire) {
      return res.status(404).json({ success: false, message: 'Questionnaire not found' });
    }

    return res.status(200).json({ success: true, data: mapQuestionnaire(questionnaire) });
  } catch (error) {
    console.error('Feedback detail error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load questionnaire' });
  }
};

exports.getAssignedQuestionnaires = async (req, res) => {
  try {
    const userId = String(req.user?._id || '');
    const questionnaires = await FeedbackQuestionnaire.find({
      status: 'active',
      recipientIds: userId,
    })
      .populate('company', 'companyName companyCode')
      .populate('branch', 'name branchCode')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    const submittedIds = await FeedbackResponse.find({
      questionnaire: { $in: questionnaires.map(item => item._id) },
      recipient: userId,
    }).distinct('questionnaire');

    const pending = questionnaires.filter(item => !submittedIds.some(id => String(id) === String(item._id)));

    return res.status(200).json({
      success: true,
      data: pending.map(questionnaire => ({
        ...mapQuestionnaire(questionnaire),
        userNameVisibilityMessage: questionnaire.nameVisibility === 'anonymous'
          ? 'Your submission will be anonymous.'
          : 'Your name will be visible to the admin.',
      })),
    });
  } catch (error) {
    console.error('Assigned feedback error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load assigned feedback' });
  }
};

exports.submitResponse = async (req, res) => {
  try {
    const questionnaire = await FeedbackQuestionnaire.findById(req.params.id).lean();
    if (!questionnaire || questionnaire.status !== 'active') {
      return res.status(404).json({ success: false, message: 'Questionnaire not found' });
    }

    const userId = String(req.user?._id || '');
    const isRecipient = (questionnaire.recipientIds || []).some(id => String(id) === userId);
    if (!isRecipient) {
      return res.status(403).json({ success: false, message: 'You are not assigned to this questionnaire' });
    }

    const existing = await FeedbackResponse.findOne({
      questionnaire: questionnaire._id,
      recipient: userId,
    }).lean();

    if (existing) {
      return res.status(409).json({ success: false, message: 'You have already submitted this feedback' });
    }

    const incomingAnswers = Array.isArray(req.body.answers) ? req.body.answers : [];
    const answerMap = new Map(
      incomingAnswers
        .map(answer => [String(answer.questionId || answer._id || ''), answer])
        .filter(([id]) => Boolean(id))
    );

    const normalizedAnswers = [];
    for (const question of questionnaire.questions || []) {
      const answer = answerMap.get(String(question._id));
      const value = answer ? answer.value : undefined;
      const hasValue = !(value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0));

      if (question.required && !hasValue) {
        return res.status(400).json({ success: false, message: `Answer is required for: ${question.label}` });
      }

      if (!hasValue) continue;

      if (['single_choice', 'text', 'textarea', 'number', 'rating'].includes(question.type) && Array.isArray(value)) {
        return res.status(400).json({ success: false, message: `Invalid answer for: ${question.label}` });
      }

      if (['multiple_choice'].includes(question.type) && !Array.isArray(value)) {
        return res.status(400).json({ success: false, message: `Invalid answer for: ${question.label}` });
      }

      normalizedAnswers.push({
        questionId: String(question._id),
        label: question.label,
        type: question.type,
        value,
      });
    }

    const created = await FeedbackResponse.create({
      questionnaire: questionnaire._id,
      recipient: userId,
      company: questionnaire.company || req.user.company || null,
      branch: req.user.branch || questionnaire.branch || null,
      recipientNameSnapshot: questionnaire.nameVisibility === 'anonymous' ? 'Anonymous' : String(req.user.name || ''),
      recipientEmailSnapshot: questionnaire.nameVisibility === 'anonymous' ? '' : String(req.user.email || ''),
      visibilityMode: questionnaire.nameVisibility,
      answers: normalizedAnswers,
      submittedAt: new Date(),
    });

    await FeedbackQuestionnaire.findByIdAndUpdate(questionnaire._id, {
      $inc: { responseCount: 1 },
    });

    return res.status(201).json({
      success: true,
      message: 'Feedback submitted successfully',
      data: created,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: 'You have already submitted this feedback' });
    }
    console.error('Feedback submit error:', error);
    return res.status(500).json({ success: false, message: 'Failed to submit feedback' });
  }
};

exports.getResponses = async (req, res) => {
  try {
    if (!isSuperAdmin(req.user)) {
      return res.status(403).json({ success: false, message: 'Only Super Admin can view responses' });
    }

    const questionnaire = await FeedbackQuestionnaire.findById(req.params.id)
      .populate('company', 'companyName companyCode')
      .populate('branch', 'name branchCode')
      .populate('createdBy', 'name email')
      .lean();

    if (!questionnaire) {
      return res.status(404).json({ success: false, message: 'Questionnaire not found' });
    }

    const responses = await FeedbackResponse.find({ questionnaire: questionnaire._id })
      .populate('recipient', 'name email employeeId department jobRole branch company')
      .sort({ submittedAt: -1 })
      .lean();

    const formattedResponses = responses.map(response => ({
      ...response,
      respondent: questionnaire.nameVisibility === 'anonymous'
        ? { name: 'Anonymous', email: '', employeeId: '', hidden: true }
        : {
          _id: response.recipient?._id,
          name: response.recipient?.name || response.recipientNameSnapshot || 'User',
          email: response.recipient?.email || response.recipientEmailSnapshot || '',
          employeeId: response.recipient?.employeeId || '',
          department: response.recipient?.department || null,
          jobRole: response.recipient?.jobRole || '',
          branch: response.recipient?.branch || null,
          company: response.recipient?.company || null,
        },
    }));

    return res.status(200).json({
      success: true,
      data: {
        questionnaire: mapQuestionnaire(questionnaire),
        responses: formattedResponses,
      },
    });
  } catch (error) {
    console.error('Feedback responses error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load responses' });
  }
};
