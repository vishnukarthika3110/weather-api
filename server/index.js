
const express = require("express");
const app = express();
const http = require("http");
const { Server } = require("socket.io");
const ACTIONS = require("./Actions");
const cors = require("cors");
const axios = require("axios");
const server = http.createServer(app);
const mongoose = require("mongoose");
require("dotenv").config();

// Enable CORS
app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Define Mongoose Schema and Model
const CodeSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true },
  code: { type: String, default: "" },
});

const Code = mongoose.model("Code", CodeSchema);

// Endpoint to fetch code by roomId
app.get("/download/:roomId", async (req, res) => {
  const { roomId } = req.params;
  try {
    const roomData = await Code.findOne({ roomId });
    if (roomData) {
      res.setHeader("Content-Disposition", "attachment; filename=text.txt");
      res.setHeader("Content-Type", "text/plain");
      res.send(roomData.code);
    } else {
      res.status(404).send("Room not found");
    }
  } catch (err) {
    console.error("Error fetching code from MongoDB:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Setup socket.io
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:5000"],
    methods: ["GET", "POST"],
  },
});

const userSocketMap = {};
const getAllConnectedClients = (roomId) => {
  return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(
    (socketId) => ({
      socketId,
      username: userSocketMap[socketId],
    })
  );
};

// Socket.io connection handling
io.on("connection", (socket) => {
  socket.on(ACTIONS.JOIN, async ({ roomId, username }) => {
    userSocketMap[socket.id] = username;
    socket.join(roomId);

    try {
      const existingRoom = await Code.findOne({ roomId });
      if (!existingRoom) {
        await Code.create({ roomId, code: "" }); // Create a new room with empty code
      }
      // Fetch the existing code for the room
      const roomData = await Code.findOne({ roomId });
      const code = roomData?.code
      
      || "";

      // Send the existing code to the newly joined user
      socket.emit(ACTIONS.CODE_CHANGE, { code });

      // Notify other clients in the room about the new user
      const clients = getAllConnectedClients(roomId);
      clients.forEach(({ socketId }) => {
        io.to(socketId).emit(ACTIONS.JOINED, {
          clients,
          username,
          socketId: socket.id,
        });
      });
    } catch (err) {
      console.error("Error retrieving room data from MongoDB:", err);
    }
  });

  socket.on(ACTIONS.CODE_CHANGE, async ({ roomId, code }) => {
    socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { code });

    // Save code changes to MongoDB
    try {
      await Code.findOneAndUpdate(
        { roomId },
        { code },
        { upsert: true, new: true }
      );
    } catch (err) {
      console.error("Error saving code to MongoDB:", err);
    }
  });

  socket.on("disconnecting", () => {
    const rooms = [...socket.rooms];
    rooms.forEach((roomId) => {
      socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
        socketId: socket.id,
        username: userSocketMap[socket.id],
      });
    });

    delete userSocketMap[socket.id];
    socket.leave();
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
