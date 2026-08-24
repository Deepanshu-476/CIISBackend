const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware');
const feedbackController = require('../controllers/feedbackController');

router.use(protect);

router.get('/assigned', feedbackController.getAssignedQuestionnaires);
router.post('/questionnaires/:id/respond', feedbackController.submitResponse);

router.get('/questionnaires', feedbackController.listQuestionnaires);
router.get('/questionnaires/:id', feedbackController.getQuestionnaireById);
router.get('/questionnaires/:id/responses', feedbackController.getResponses);
router.post('/questionnaires', feedbackController.createQuestionnaire);

module.exports = router;
