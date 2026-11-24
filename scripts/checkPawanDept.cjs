const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const users = mongoose.connection.collection('users');
  const departments = mongoose.connection.collection('departments');

  const pawan = await users.findOne({ email: 'officialmailcds@gmail.com' });
  console.log('Pawan department:', pawan.department, pawan.departmentName);

  if (pawan.department) {
    const dept = await departments.findOne({ _id: new mongoose.Types.ObjectId(pawan.department) });
    console.log('Dept:', dept);
  }

  await mongoose.disconnect();
}

run().catch(console.error);

