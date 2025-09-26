// middleware/validationMiddleware.js
const { body } = require('express-validator');

const validateTaskCreation = [
  body('title').trim()
    .notEmpty().withMessage('Title is required')
    .isLength({ min: 3, max: 100 }).withMessage('Title must be 3-100 characters'),
  
  body('description').optional().trim()
    .isLength({ max: 1000 }).withMessage('Description too long'),
  
  body('dueDate')
    .notEmpty().withMessage('Due date is required')
    .isISO8601().withMessage('Invalid date format')
    .custom(value => new Date(value) > new Date()).withMessage('Due date must be in the future'),
  
  body('priorityDays')
    .notEmpty().withMessage('Priority days is required')
    .isInt({ min: 1, max: 30 }).withMessage('Priority days must be 1-30'),
  
  body('whatsappNumber').optional()
    .isMobilePhone().withMessage('Invalid phone number')
];

module.exports = {
  validateTaskCreation
};