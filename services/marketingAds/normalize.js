const validator = require('validator');

const clean = (value, limit = 1000) => typeof value === 'string' ? value.trim().slice(0, limit)
  : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : '';
const keyOf = value => clean(value, 150).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '');
const numericId = value => /^\d{1,30}$/.test(clean(value, 31)) ? clean(value, 30) : '';

const aliases = {
  name: ['full_name', 'name'],
  firstName: ['first_name', 'given_name'],
  lastName: ['last_name', 'family_name'],
  email: ['email', 'email_address', 'work_email'],
  phone: ['phone_number', 'phone', 'work_phone', 'mobile_phone', 'mobile_number'],
  company: ['company_name', 'company', 'business_name', 'work_company'],
  gender: ['gender'],
  street: ['street_address', 'address', 'address_1', 'address_line_1'],
  city: ['city'],
  region: ['region', 'state', 'province', 'state_province'],
  postal: ['postal_code', 'zip_code', 'zip', 'post_code'],
  country: ['country'],
  remarks: ['remarks', 'comments', 'message', 'notes']
};
const standard = new Set(Object.values(aliases).flat());
const genders = new Map([['male', 'Male'], ['female', 'Female'], ['other', 'Other']]);
const metaChannels = new Map([['ig', 'Instagram'], ['instagram', 'Instagram'], ['fb', 'Facebook'], ['facebook', 'Facebook']]);

function parseColumns(platform, data) {
  const columns = platform === 'meta' ? data.field_data : data.user_column_data;
  if (!Array.isArray(columns)) return new Map();
  return new Map(columns.slice(0, 300).flatMap(column => {
    const rawKey = clean(platform === 'meta' ? column?.name : column?.column_id || column?.column_name, 150);
    const key = keyOf(rawKey);
    if (!key) return [];
    const values = platform === 'meta' && Array.isArray(column.values) ? column.values : [column.string_value];
    const value = clean(values.slice(0, 30).map(v => clean(v)).filter(Boolean).join(', '));
    return [[key, { key, label: clean(column.column_name, 80) || rawKey.replaceAll('_', ' '), value }]];
  }));
}

function normalizePhone(value) {
  const raw = clean(value, 60);
  if (!/^[+\d().\s-]+$/.test(raw)) return '';
  const digits = raw.replace(/\D/g, '');
  const international = raw.startsWith('+') || digits.startsWith('00');
  const number = digits.startsWith('00') ? digits.slice(2) : digits;
  if (number.length < 7 || number.length > 15) return '';
  return international ? `+${number}` : number;
}

function phoneKey(phone) {
  return /^\+91[6-9]\d{9}$/.test(phone) ? phone.slice(3) : phone;
}

function normalize(platform, data, event, connection) {
  const columns = parseColumns(platform, data);
  const read = keys => keys.map(key => columns.get(key)?.value).find(Boolean) || '';
  const value = field => read(aliases[field]);
  const formId = numericId(data.form_id) || numericId(event.form_id);
  const mapping = connection.mappings?.find(item => item.formId === formId) ||
    connection.mappings?.find(item => !item.formId);
  const answers = mapping
    ? mapping.fields.slice(0, 4).map(field => ({ label: field.label, value: columns.get(field.key)?.value || '' }))
    : [...columns.values()].filter(field => !standard.has(field.key)).slice(0, 4).map(({ label, value }) => ({ label, value }));
  const source = platform === 'meta' ? 'Meta Ads' : 'Google Ads';
  const channel = clean(data.platform || event.platform, 30).toLowerCase();
  const email = value('email').toLowerCase();
  const gender = value('gender').toLowerCase();
  const campaignId = numericId(data.campaign_id) || numericId(event.campaign_id);
  const campaignName = clean(data.campaign_name || connection.campaigns?.find(c => c.id === campaignId)?.name, 200);
  const date = typeof data.created_time === 'string' ? new Date(data.created_time) : null;
  return {
    name: clean(value('name') || [value('firstName'), value('lastName')].filter(Boolean).join(' '), 100),
    email: email.length <= 254 && validator.isEmail(email) ? email : '',
    phone: normalizePhone(value('phone')),
    gender: genders.get(gender) || '',
    address: clean(['street', 'city', 'region', 'postal', 'country'].map(value).filter(Boolean).join(', ')),
    remarks: value('remarks'),
    leadDate: date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : '',
    source,
    leadSourceName: source,
    campaignName,
    marketing: {
      platform, sourceType: 'paid_ads', channel: platform === 'google' ? 'Google' : metaChannels.get(channel) || '',
      integration: connection._id, accountId: connection.externalAccountId, accountName: connection.accountName,
      pageName: platform === 'meta' ? connection.accountName : '',
      campaignId, adGroupId: numericId(data.adgroup_id || data.ad_group_id || data.adset_id || event.adgroup_id),
      adGroupName: clean(data.adset_name || data.ad_group_name, 200),
      adId: numericId(data.ad_id || data.creative_id || event.ad_id), adName: clean(data.ad_name, 200),
      formId, formName: clean(data.form_name || connection.forms?.find(form => form.id === formId)?.name, 200),
      advertiserCompany: clean(value('company'), 150), answers
    }
  };
}

module.exports = { clean, keyOf, numericId, normalize, phoneKey };
