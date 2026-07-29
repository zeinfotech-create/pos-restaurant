// Escapes user-controlled text before it's interpolated into an innerHTML
// template string. A crafted name (customer, staff, user, branch — anything
// a low-privilege user can type into a form) containing HTML/script would
// otherwise execute the moment any screen renders it back, since none of
// this app's page templates go through a framework that auto-escapes.
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
