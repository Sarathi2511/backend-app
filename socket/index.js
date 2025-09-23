const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

let io;

const initializeSocket = (server) => {
  try {
    io = socketIO(server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      },
      pingTimeout: 60000,
      pingInterval: 25000,
      upgradeTimeout: 30000,
      allowUpgrades: true
    });

    console.log('Socket.IO server initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Socket.IO:', error);
    throw error;
  }

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        console.log('Socket connection rejected: No token provided');
        return next(new Error('Authentication error: No token provided'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      
      if (!user) {
        console.log('Socket connection rejected: User not found for token');
        return next(new Error('Authentication error: User not found'));
      }

      socket.user = {
        id: user._id,
        name: user.name,
        role: user.role
      };
      
      console.log(`Socket authentication successful for user: ${user.name} (${user.role})`);
      next();
    } catch (error) {
      console.error('Socket authentication error:', error.message);
      next(new Error('Authentication error: Invalid token'));
    }
  });

  // Connection handler
  io.on('connection', (socket) => {
    try {
      console.log(`User connected: ${socket.user.name} (${socket.user.role})`);
      
      // Join role-based room
      socket.join(`role_${socket.user.role.toLowerCase()}`);
      
      // Join user-specific room
      socket.join(`user_${socket.user.id}`);

      // Emit user connected event to admins
      if (io) {
        io.to('role_admin').emit('user:connected', {
          user: {
            id: socket.user.id,
            name: socket.user.name,
            role: socket.user.role
          },
          timestamp: new Date()
        });
      }

      socket.on('disconnect', (reason) => {
        try {
          console.log(`User disconnected: ${socket.user.name} (${socket.user.role}) - Reason: ${reason}`);
          
          // Emit user disconnected event to admins
          if (io) {
            io.to('role_admin').emit('user:disconnected', {
              user: {
                id: socket.user.id,
                name: socket.user.name,
                role: socket.user.role
              },
              timestamp: new Date(),
              reason: reason
            });
          }
        } catch (error) {
          console.error('Error handling socket disconnect:', error);
        }
      });

      socket.on('error', (error) => {
        console.error(`Socket error for user ${socket.user.name}:`, error);
      });

    } catch (error) {
      console.error('Error in socket connection handler:', error);
      socket.disconnect(true);
    }
  });

  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
};

module.exports = { initializeSocket, getIO }; 