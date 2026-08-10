export class SafetyChecker {
  config;

  constructor(config) {
    this.config = config;
  }

  checkEmail(to, cc = [], bcc = []) {
    const violations = [];
    const allRecipients = [...to, ...cc, ...bcc];
    if (!this.config.allow_external_recipients) {
      const external = allRecipients.filter((email) => {
        const domain = email.split('@')[1];
        return !this.config.allowed_domains.includes(domain);
      });
      if (external.length > 0) {
        violations.push(`external_recipients_blocked: ${external.join(', ')}`);
      }
    }
    return violations;
  }

  checkEventTime(startIso, endIso) {
    const violations = [];
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (
      start.getHours() < this.config.time_guard_start_hour ||
      start.getHours() >= this.config.time_guard_end_hour
    ) {
      violations.push(
        `event_outside_working_hours: ${startIso} ` +
          `(allowed: ${this.config.time_guard_start_hour}:00-${this.config.time_guard_end_hour}:00)`,
      );
    }
    if (end.getHours() > this.config.time_guard_end_hour) {
      violations.push(`event_ends_outside_working_hours: ${endIso}`);
    }
    if (start < new Date()) violations.push('event_in_past');
    return violations;
  }

  checkDelete(resourceType) {
    return this.config.allow_deletes ? [] : [`delete_blocked: ${resourceType}`];
  }

  assessRisk(violations) {
    if (violations.length === 0) return 'low';
    if (violations.some((violation) => violation.includes('external_recipients'))) return 'high';
    if (violations.some((violation) => violation.includes('delete'))) return 'high';
    return 'medium';
  }
}
