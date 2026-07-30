const mongoose = require("mongoose");

const mongoOptions = {
  family: 4,
  serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 30000),
  connectTimeoutMS: Number(process.env.MONGO_CONNECT_TIMEOUT_MS || 30000),
  socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 120000),
  heartbeatFrequencyMS: 10000,
  maxPoolSize: 20,
  minPoolSize: 0,  
  maxIdleTimeMS: 60000,
  waitQueueTimeoutMS: Number(process.env.MONGO_WAIT_QUEUE_TIMEOUT_MS || 30000),
};

const INITIAL_CONNECT_RETRY_MS = Number(process.env.MONGO_INITIAL_CONNECT_RETRY_MS || 5000);

let listenersRegistered = false;

const registerConnectionListeners = () => {
  if (listenersRegistered) return;
  listenersRegistered = true;

  mongoose.connection.on("connected", () => {
    console.log("MongoDB connected");
  });

  mongoose.connection.on("reconnected", () => {
    console.log("MongoDB reconnected");
  });

  mongoose.connection.on("disconnected", () => {
    console.warn("MongoDB disconnected");
  });

  mongoose.connection.on("error", (err) => {
    console.error("MongoDB connection error:", err.message);
  });
};

const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    console.error("MongoDB connection failed: MONGO_URI is missing in environment");
    process.exit(1);
  }

  registerConnectionListeners();

  while (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(process.env.MONGO_URI, mongoOptions);
    } catch (err) {
      console.error(`MongoDB connection failed: ${err.message}. Retrying in ${INITIAL_CONNECT_RETRY_MS}ms`);
      await new Promise(resolve => setTimeout(resolve, INITIAL_CONNECT_RETRY_MS));
    }
  }
};

module.exports = connectDB;
