// lib/db.js
// MongoDB connection via Mongoose.

import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI?.trim();

let connectPromise = null;

export function connectDB() {
  if (!MONGODB_URI) {
    console.warn(
      "[db] MONGODB_URI is not set — add it to .env."
    );

    return Promise.resolve(false);
  }

  if (!connectPromise) {
    mongoose.connection.on("connected", () => {
      console.log(
        `[db] MongoDB connected → ${mongoose.connection.name}`
      );
    });

    mongoose.connection.on("error", (err) => {
      console.error(
        "[db] MongoDB connection error:",
        err.message
      );
    });

    mongoose.connection.on("disconnected", () => {
      console.warn("[db] MongoDB disconnected");
    });

    connectPromise = mongoose
      .connect(MONGODB_URI, {
        // MongoDB Atlas uses TLS
        tls: true,

        // Prefer IPv4 on Windows
        family: 4,

        // Give Atlas enough time to respond
        serverSelectionTimeoutMS: 15000,
        connectTimeoutMS: 15000,

        // Keep the connection alive
        socketTimeoutMS: 45000,
      })
      .then(() => {
        console.log("[db] MongoDB connection established");
        return true;
      })
      .catch((err) => {
        console.error(
          "[db] Failed to connect to MongoDB:",
          err.message
        );

        connectPromise = null;
        return false;
      });
  }

  return connectPromise;
}

export function isDBConnected() {
  return mongoose.connection.readyState === 1;
}