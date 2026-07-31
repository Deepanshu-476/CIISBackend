const cron = require("node-cron");

const User = require("../models/User");
const Company = require("../models/Company");
const WorkAnniversaryEmailLog = require("../models/WorkAnniversaryEmailLog");
const emailService = require("./emailService");

const INDIA_TIME_ZONE = "Asia/Kolkata";
const WORK_ANNIVERSARY_TEMPLATE_VERSION = "purple-enhanced-v4-test";

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const getIndiaDateParts = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: INDIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
};

const getJoiningDateParts = (dateOfJoining) => {
  const date = new Date(dateOfJoining);
  if (Number.isNaN(date.getTime())) return null;

  // dateOfJoining is a calendar date, so UTC prevents a stored midnight value
  // from shifting to another day when the server timezone changes.
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
};

const isAnniversaryToday = (joining, today) => {
  if (joining.month === today.month && joining.day === today.day) return true;

  // Employees who joined on 29 February are celebrated on 28 February
  // during non-leap years.
  const isLeapYear =
    today.year % 4 === 0 && (today.year % 100 !== 0 || today.year % 400 === 0);
  return (
    joining.month === 2 &&
    joining.day === 29 &&
    today.month === 2 &&
    today.day === 28 &&
    !isLeapYear
  );
};

const ordinal = (value) => {
  const remainder100 = value % 100;
  if (remainder100 >= 11 && remainder100 <= 13) return `${value}th`;
  if (value % 10 === 1) return `${value}st`;
  if (value % 10 === 2) return `${value}nd`;
  if (value % 10 === 3) return `${value}rd`;
  return `${value}th`;
};

const buildEmailHtml = ({ user, company, completedYears }) => {
  const employeeName = escapeHtml(user.name || "Team Member");
  const companyName = escapeHtml(company?.companyName || "Your Company");
  const joiningDate = new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(user.dateOfJoining));
  const logo = company?.logo
    ? `<img src="${escapeHtml(company.logo)}" width="150" alt="${companyName}" style="display:block;width:auto;max-width:150px;height:auto;max-height:52px;border:0;" />`
    : `<span style="color:#30245e;font-size:19px;font-weight:700;letter-spacing:.2px;">${companyName}</span>`;

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <meta name="color-scheme" content="light only">
        <title>Happy Work Anniversary</title>
      </head>
      <body style="margin:0;padding:0;background-color:#eef2f7;font-family:Arial,Helvetica,sans-serif;color:#172033;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
          Congratulations ${employeeName} on your ${ordinal(completedYears)} work anniversary with ${companyName}.
        </div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#eef2f7;">
          <tr>
            <td align="center" style="padding:34px 12px;">
              <table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;background-color:#ffffff;border:1px solid #dfe5ee;border-radius:18px;overflow:hidden;box-shadow:0 12px 35px rgba(15,23,42,.08);">
                <tr>
                  <td style="height:6px;background-color:#6255d9;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
                <tr>
                  <td align="center" style="padding:42px 36px 38px;background-color:#6948e8;background-image:linear-gradient(135deg,#5c55dc 0%,#7838ed 100%);color:#ffffff;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 28px;">
                      <tr>
                        <td align="center" style="padding:12px 22px;border-radius:10px;background-color:#ffffff;">${logo}</td>
                      </tr>
                    </table>
                    <div style="font-size:42px;line-height:1;margin:0 0 17px;">&#127881;</div>
                    <span style="display:inline-block;margin-bottom:16px;padding:7px 13px;border:1px solid rgba(255,255,255,.35);border-radius:999px;background-color:rgba(255,255,255,.13);color:#ffffff;font-size:10px;font-weight:700;letter-spacing:1.3px;">${ordinal(completedYears).toUpperCase()} MILESTONE</span>
                    <h1 style="margin:0;color:#ffffff;font-size:32px;line-height:1.25;font-weight:700;">Happy Work Anniversary!</h1>
                    <p style="margin:13px 0 0;color:#f0ecff;font-size:16px;line-height:1.6;">Celebrating ${completedYears} wonderful year${completedYears === 1 ? "" : "s"} together</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:38px 44px 14px;text-align:center;">
                    <h2 style="margin:0 0 18px;color:#172033;font-size:25px;line-height:1.4;font-weight:700;">Congratulations, ${employeeName}!</h2>
                    <p style="margin:0;color:#556176;font-size:16px;line-height:1.75;">
                      On behalf of everyone at ${companyName}, we are delighted to celebrate your
                      <strong style="color:#6746dc;"> ${ordinal(completedYears)} work anniversary</strong>.
                      Your professionalism, commitment, and valuable contribution continue to strengthen our organization.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:22px 44px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f7f5ff;border:1px solid #e2ddff;border-radius:14px;">
                      <tr>
                        <td align="center" style="padding:21px 18px;">
                          <span style="display:block;margin-bottom:7px;color:#746d91;font-size:10px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;">Journey began</span>
                          <strong style="display:block;color:#30245e;font-size:17px;">${escapeHtml(joiningDate)}</strong>
                        </td>
                        <td style="width:1px;background-color:#ddd9f5;font-size:0;line-height:0;">&nbsp;</td>
                        <td align="center" style="padding:21px 18px;">
                          <span style="display:block;margin-bottom:7px;color:#746d91;font-size:10px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;">Celebrating</span>
                          <strong style="display:block;color:#30245e;font-size:17px;">${completedYears} Year${completedYears === 1 ? "" : "s"}</strong>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 44px 42px;text-align:center;">
                    <p style="margin:0 0 27px;color:#556176;font-size:16px;line-height:1.75;">
                      Thank you for the energy, expertise, and integrity you bring to work each day.
                      We value your journey with us and look forward to achieving many more milestones together.
                    </p>
                    <div style="width:48px;height:3px;margin:0 auto 18px;background-color:#6948e8;border-radius:3px;font-size:0;line-height:0;">&nbsp;</div>
                    <p style="margin:0;color:#334057;font-size:15px;line-height:1.65;">
                      With sincere appreciation,<br>
                      <strong>The ${companyName} Team</strong>
                    </p>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:20px 28px;background-color:#f7f9fc;border-top:1px solid #e5eaf1;color:#8791a2;font-size:11px;line-height:1.6;">
                    This milestone message was sent by ${companyName}.<br>
                    Please do not reply to this automated email.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
};

const runWorkAnniversaryEmails = async (now = new Date()) => {
  const today = getIndiaDateParts(now);
  const users = await User.find({
    isActive: true,
    email: { $exists: true, $nin: [null, ""] },
    dateOfJoining: { $exists: true, $ne: null },
  })
    .select("_id name email company companyCode dateOfJoining")
    .lean();

  const companyIds = [...new Set(users.map((user) => String(user.company || "")).filter(Boolean))];
  const companies = await Company.find({ _id: { $in: companyIds }, isActive: true })
    .select("_id companyName companyCode logo")
    .lean();
  const companyById = new Map(companies.map((company) => [String(company._id), company]));

  const summary = { checked: users.length, matched: 0, sent: 0, skipped: 0, failed: 0 };

  for (const user of users) {
    const joining = getJoiningDateParts(user.dateOfJoining);
    if (!joining || !isAnniversaryToday(joining, today)) continue;

    const completedYears = today.year - joining.year;
    if (completedYears < 1) continue;

    const company = companyById.get(String(user.company));
    if (!company) {
      summary.skipped += 1;
      continue;
    }

    summary.matched += 1;

    const existingSentLog = await WorkAnniversaryEmailLog.exists({
      user: user._id,
      anniversaryYear: today.year,
      templateVersion: WORK_ANNIVERSARY_TEMPLATE_VERSION,
      status: { $in: ["pending", "sent", "skipped"] },
    });
    if (existingSentLog) {
      summary.skipped += 1;
      continue;
    }

    const log = await WorkAnniversaryEmailLog.findOneAndUpdate(
      { user: user._id, anniversaryYear: today.year },
      {
        $set: {
          company: company._id,
          companyCode: company.companyCode || user.companyCode,
          completedYears,
          templateVersion: WORK_ANNIVERSARY_TEMPLATE_VERSION,
          email: user.email,
          status: "pending",
          lastAttemptAt: new Date(),
          error: "",
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    try {
      const subject = `Happy ${ordinal(completedYears)} Work Anniversary, ${user.name}!`;
      const result = await emailService.sendEmail(
        user.email,
        subject,
        buildEmailHtml({ user, company, completedYears }),
        {
          emailModuleKey: "work_anniversary",
          referenceId: `work-anniversary-${user._id}-${today.year}`,
          notificationType: "work_anniversary",
          notificationTitle: "Happy Work Anniversary!",
          notificationMessage: `${company.companyName} celebrates your ${ordinal(completedYears)} work anniversary.`,
          notificationTargetPath: "/ciisUser/user-dashboard",
          company: company._id,
          headers: {
            "X-Company-Code": company.companyCode || user.companyCode,
            "X-Email-Type": "work-anniversary",
          },
        }
      );

      if (result?.success && !result?.skipped) {
        log.status = "sent";
        log.sentAt = new Date();
        summary.sent += 1;
      } else if (result?.skipped) {
        log.status = "skipped";
        log.error = result.message || "Email module is disabled";
        summary.skipped += 1;
      } else {
        log.status = "failed";
        log.error = result?.error || "Email service returned an unsuccessful result";
        summary.failed += 1;
      }
    } catch (error) {
      log.status = "failed";
      log.error = String(error?.message || error).slice(0, 1000);
      summary.failed += 1;
    }

    await log.save();
  }

  return summary;
};

cron.schedule(
  // Run hourly so an email is not missed when the server was unavailable at
  // 9:00 AM or an employee's joining date is added later in the day. The
  // yearly per-user log keeps these catch-up runs idempotent.
  "5 * * * *",
  async () => {
    try {
      const summary = await runWorkAnniversaryEmails();
      console.log("Work anniversary email job completed:", summary);
    } catch (error) {
      console.error("Work anniversary email job failed:", error);
    }
  },
  { timezone: INDIA_TIME_ZONE }
);

module.exports = {
  runWorkAnniversaryEmails,
  getIndiaDateParts,
  getJoiningDateParts,
  isAnniversaryToday,
};
