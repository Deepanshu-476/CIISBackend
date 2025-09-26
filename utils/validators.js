// utils/validators.js
exports.isValidPhoneNumber = (number) => {
  return /^[0-9]{10,15}$/.test(number);
};