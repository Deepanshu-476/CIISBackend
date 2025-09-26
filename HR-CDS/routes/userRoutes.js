// routes/userRoutes.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userControllers');
const auth = require('../../middleware/authMiddleware');

const isAdmin = require('../../middleware/isAdmin');

router.get('/all-users', auth, isAdmin, userController.getAllUsers);

module.exports = router;
