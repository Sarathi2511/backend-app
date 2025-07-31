const { getIO } = require('./index');

// Product events
const emitProductCreated = (product, createdBy) => {
  const io = getIO();
  
  // Emit to all connected users (Admin, Staff, Executive can all see products)
  io.emit('product:created', {
    product,
    createdBy: {
      id: createdBy.id,
      name: createdBy.name,
      role: createdBy.role
    },
    timestamp: new Date()
  });
};

const emitProductUpdated = (product, updatedBy) => {
  const io = getIO();
  
  // Emit to all connected users
  io.emit('product:updated', {
    product,
    updatedBy: {
      id: updatedBy.id,
      name: updatedBy.name,
      role: updatedBy.role
    },
    timestamp: new Date()
  });
};

const emitProductDeleted = (productId, productName, deletedBy) => {
  const io = getIO();
  
  // Emit to all connected users
  io.emit('product:deleted', {
    productId,
    productName,
    deletedBy: {
      id: deletedBy.id,
      name: deletedBy.name,
      role: deletedBy.role
    },
    timestamp: new Date()
  });
};

// Staff events
const emitStaffCreated = (staff, createdBy) => {
  const io = getIO();
  
  // Emit to admin users only (staff management is admin-only)
  io.to('role_admin').emit('staff:created', {
    staff,
    createdBy: {
      id: createdBy.id,
      name: createdBy.name,
      role: createdBy.role
    },
    timestamp: new Date()
  });
};

const emitStaffUpdated = (staff, updatedBy) => {
  const io = getIO();
  
  // Emit to admin users only
  io.to('role_admin').emit('staff:updated', {
    staff,
    updatedBy: {
      id: updatedBy.id,
      name: updatedBy.name,
      role: updatedBy.role
    },
    timestamp: new Date()
  });
};

const emitStaffDeleted = (staffId, staffName, deletedBy) => {
  const io = getIO();
  
  // Emit to admin users only
  io.to('role_admin').emit('staff:deleted', {
    staffId,
    staffName,
    deletedBy: {
      id: deletedBy.id,
      name: deletedBy.name,
      role: deletedBy.role
    },
    timestamp: new Date()
  });
};

// Order events
const emitOrderCreated = (order, createdBy) => {
  const io = getIO();
  
  // Emit to all connected users (Admin, Staff, Executive can all see orders)
  io.emit('order:created', {
    order,
    createdBy: {
      id: createdBy.id,
      name: createdBy.name,
      role: createdBy.role
    },
    timestamp: new Date()
  });
};

const emitOrderUpdated = (order, updatedBy) => {
  const io = getIO();
  
  // Emit to all connected users
  io.emit('order:updated', {
    order,
    updatedBy: {
      id: updatedBy.id,
      name: updatedBy.name,
      role: updatedBy.role
    },
    timestamp: new Date()
  });
};

const emitOrderDeleted = (orderId, orderName, deletedBy) => {
  const io = getIO();
  
  // Emit to all connected users
  io.emit('order:deleted', {
    orderId,
    orderName,
    deletedBy: {
      id: deletedBy.id,
      name: deletedBy.name,
      role: deletedBy.role
    },
    timestamp: new Date()
  });
};

module.exports = {
  emitProductCreated,
  emitProductUpdated,
  emitProductDeleted,
  emitStaffCreated,
  emitStaffUpdated,
  emitStaffDeleted,
  emitOrderCreated,
  emitOrderUpdated,
  emitOrderDeleted
}; 