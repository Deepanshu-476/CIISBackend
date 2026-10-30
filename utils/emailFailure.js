const getEmailFailure = (error = {}) => {
  const detail = String(error.response || error.message || error.error || '');
  if (/5\.4\.5|daily.*sending limit|sending quota.*exceed/i.test(detail)) {
    return { errorCode: 'EMAIL_QUOTA_EXCEEDED', message: 'Email sending limit reached. Please try again later (it may take up to 24 hours).' };
  }
  if (/outbound sending is disabled/i.test(detail)) {
    return { errorCode: 'EMAIL_SENDING_DISABLED', message: 'Email sending is blocked by the email provider. Please contact administrator.' };
  }
  return { errorCode: 'EMAIL_SERVICE_UNAVAILABLE', message: 'Email service is unavailable. Please contact administrator.' };
};

module.exports = { getEmailFailure };
