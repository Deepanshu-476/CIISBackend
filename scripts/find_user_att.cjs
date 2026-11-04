const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

async function run() {
  console.log("URI present?", Boolean(process.env.MONGO_URI));
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
    console.log("Connected to MongoDB!");

    const usersColl = mongoose.connection.collection('users');
    const user = await usersColl.findOne({ email: { $regex: 'ciisvanshgupta@gmail.com', $options: 'i' } });
    console.log("Found user:", user ? { _id: user._id, name: user.name, email: user.email, companyCode: user.companyCode } : "NOT FOUND");

    if (user) {
      const attendanceColl = mongoose.connection.collection('attendances');
      const recent = await attendanceColl.find({ user: user._id }).sort({ date: -1 }).limit(3).toArray();
      console.log("Recent attendance:", JSON.stringify(recent, null, 2));
    }
  } catch (err) {
    console.error("Error connecting/querying:", err.message);
  } finally {
    await mongoose.disconnect();
  }
}

run();

