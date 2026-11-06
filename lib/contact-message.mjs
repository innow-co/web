export function makeMessage(input) {
  const organization = typeof input?.organization === 'string' ? input.organization.trim() : '';
  const email = typeof input?.email === 'string' ? input.email.trim() : '';
  const course = typeof input?.course === 'string' ? input.course.trim() : '';
  const expectation = typeof input?.expectation === 'string' ? input.expectation.trim() : '';
  const details = typeof input?.details === 'string' ? input.details.trim() : '';
  const learners = Number(input?.learners);
  if (!organization || organization.length > 160 || /[\r\n]/.test(organization) ||
      email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !course || course.length > 200 || /[\r\n]/.test(course) ||
      !expectation || expectation.length > 300 || /[\r\n]/.test(expectation) || details.length > 2000 ||
      !Number.isSafeInteger(learners) || learners < 1 || learners > 100000) {
    throw new Error('Invalid form data');
  }
  return {
    FromEmailAddress: 'ask@innow.co.th',
    Destination: { ToAddresses: ['ask@innow.co.th'] },
    ReplyToAddresses: [email],
    Content: { Simple: {
      Subject: { Data: `ขอใบเสนอราคาอบรม — ${organization}`, Charset: 'UTF-8' },
      Body: { Text: { Data: `ชื่อองค์กร: ${organization}\nอีเมลติดต่อ: ${email}\nหลักสูตรที่สนใจ: ${course}\nรูปแบบและความคาดหวัง: ${expectation}\nรายละเอียดเพิ่มเติม: ${details || '-'}\nจำนวนผู้เรียนโดยประมาณ: ${learners} คน`, Charset: 'UTF-8' } }
    } }
  };
}
