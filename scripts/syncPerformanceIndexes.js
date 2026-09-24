require("dotenv").config();
const mongoose = require("mongoose");

const models = [
  require("../HR-CDS/chat/models/Message"),
  require("../HR-CDS/chat/models/Conversation"),
  require("../models/Device"),
  require("../HR-CDS/models/Meeting"),
  require("../HR-CDS/models/MeetingView"),
  require("../HR-CDS/models/alertModel"),
  require("../HR-CDS/models/Task"),
  require("../HR-CDS/models/ClientTask"),
  require("../HR-CDS/models/Notification"),
  require("../models/User"),
  require("../HR-CDS/models/Attendance"),
];

const mongoOptions = {
  family: 4,
  serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 30000),
  connectTimeoutMS: Number(process.env.MONGO_CONNECT_TIMEOUT_MS || 30000),
  socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 120000),
};

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing in environment");
  }

  await mongoose.connect(process.env.MONGO_URI, mongoOptions);

  for (const model of models) {
    console.log(`Creating missing indexes for ${model.modelName}...`);
    await model.createIndexes();
  }

  console.log("Performance indexes created.");
};

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
