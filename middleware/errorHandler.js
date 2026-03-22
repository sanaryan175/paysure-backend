const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;

  // Always print full error in terminal so we can debug
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error(`[ERROR] ${err.message}`);
  console.error(`[ROUTE] ${req.method} ${req.originalUrl}`);
  console.error(`[STACK] ${err.stack}`);
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

export default errorHandler;