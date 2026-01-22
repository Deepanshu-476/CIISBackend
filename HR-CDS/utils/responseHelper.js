exports.errorResponse = (res, statusCode, message) => {
  return res.status(statusCode).json({
    success: false,
    error: message
  });
};

exports.successResponse = (res, statusCode, message, data = null) => {
  const response = {
    success: true,
    message
  };
  
  if (data) {
    response.data = data;
  }
  
  return res.status(statusCode).json(response);
};