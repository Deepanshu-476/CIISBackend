const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Define the MenuAccess Schema
const menuAccessSchema = new Schema(
  {
    department: {
      type: Schema.Types.ObjectId,
      ref: 'Department', // Assuming you have a Department model to reference
      required: true
    },
    jobRole: {
      type: String,
      
    },
    accessItems: {
      type: [String], // Array of strings to store the menu access items
      required: true
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User', // Assuming you have a User model to reference
      required: true
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User', // Assuming you have a User model to reference
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: {
      type: Date
    }
  },
  { timestamps: true }
);

// Create a model from the schema
const MenuAccess = mongoose.model('MenuAccess', menuAccessSchema);

module.exports = MenuAccess;
