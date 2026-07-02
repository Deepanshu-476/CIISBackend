const mongoose = require('mongoose');
const Schema = mongoose.Schema;


const menuAccessSchema = new Schema(
  {
    department: {
      type: Schema.Types.ObjectId,
      ref: 'Department', 
      required: true
    },
    jobRole: {
      type: String,
      
    },
    accessItems: {
      type: [String], 
      required: true
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User', 
      required: true
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User', 
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


const MenuAccess = mongoose.model('MenuAccess', menuAccessSchema);

module.exports = MenuAccess;
