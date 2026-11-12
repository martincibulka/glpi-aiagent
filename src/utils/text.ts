/**
 * Pomocné funkcie pre čistenie a predspracovanie textov tiketov
 */

export function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function cleanTicketDescription(raw: string): string {
  let text = stripHtml(raw);

  // Odstránenie bežných emailových podpisov a disclaimers
  const signatures = [
    /--\s*\n[\s\S]*/i,
    /S pozdravom[\s\S]*/i,
    /S úctou[\s\S]*/i,
    /Best regards[\s\S]*/i,
    /Kind regards[\s\S]*/i,
    /Sent from my iPhone[\s\S]*/i,
    /Odoslané z Outlooku[\s\S]*/i,
  ];

  for (const sig of signatures) {
    text = text.replace(sig, '').trim();
  }

  return text;
}

export function truncate(text: string, maxLength = 500): string {
  if (!text || text.length <= maxLength) return text || '';
  return text.slice(0, maxLength) + '...';
}
