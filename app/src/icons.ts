// Inline stroke icons (24×24 grid) so they follow the text colour and theme.
export const icons: Record<string, string> = {
  daylight: '<path d="M3 15h18M6 19h12M6.5 12a5.5 5.5 0 0111 0M12 2v2M4.4 5.3l1.5 1.4M19.6 5.3l-1.5 1.4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  circle: '<circle cx="12" cy="12" r="8.5"/>',
  "circle-check":
    '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.2l2.4 2.4 4.6-4.8"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash:
    '<path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 002 1.8h7a2 2 0 002-1.8l1-12M9 7V4.5h6V7"/>',
  settings:
    '<path d="M10.3 4.3c.4-1.7 3-1.7 3.4 0a1.7 1.7 0 002.6 1.1c1.5-.9 3.3.8 2.4 2.4a1.7 1.7 0 001 2.5c1.8.4 1.8 3 0 3.4a1.7 1.7 0 00-1 2.6c.9 1.5-.9 3.3-2.4 2.4a1.7 1.7 0 00-2.6 1c-.4 1.8-3 1.8-3.4 0a1.7 1.7 0 00-2.5-1c-1.6.9-3.3-.9-2.4-2.4a1.7 1.7 0 00-1.1-2.6c-1.7-.4-1.7-3 0-3.4a1.7 1.7 0 001.1-2.5c-.9-1.6.8-3.3 2.4-2.4a1.7 1.7 0 002.5-1.1z"/><circle cx="12" cy="12" r="3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
  dots: '<circle cx="5" cy="12" r=".9"/><circle cx="12" cy="12" r=".9"/><circle cx="19" cy="12" r=".9"/>',
  "calendar-week":
    '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M16 3v4M8 3v4M4 11h16"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  tag: '<path d="M7.5 7.5h.01M3 6v5.2a2 2 0 00.6 1.4l7.8 7.8a2 2 0 002.8 0l5.2-5.2a2 2 0 000-2.8L11.6 4.6A2 2 0 0010.2 4H5a2 2 0 00-2 2z"/>',
  bell: '<path d="M10 5a2 2 0 014 0 7 7 0 014 6v3l2 3H4l2-3v-3a7 7 0 014-6M9 17v1a3 3 0 006 0v-1"/>',
  repeat:
    '<path d="M4 12V9a3 3 0 013-3h13l-3-3M20 12v3a3 3 0 01-3 3H4l3 3"/>',
  "external-link":
    '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
  note: '<path d="M6 4h9l4 4v12H6zM14 4v5h5M9 13h6M9 16.5h4"/>',
  "list-check":
    '<path d="M10 6h10M10 12h10M10 18h10M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',
  obsidian:
    '<path d="M9 3l7 3 3 7-5 8-7-2-3-8z"/><path d="M9 3l1 9-5-1M10 12l4 9"/>',
  history: '<path d="M4 12a8 8 0 103-6.2M4 4v4h4M12 8v4l3 2"/>',
  folder:
    '<path d="M4 6.5A1.5 1.5 0 015.5 5H10l2 2h6.5A1.5 1.5 0 0120 8.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
  keyboard:
    '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>',
  "arrow-left": '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  "arrow-right": '<path d="M5 12h14M13 6l6 6-6 6"/>',
  "chevron-right": '<path d="M9 6l6 6-6 6"/>',
  "chevron-down": '<path d="M6 9l6 6 6-6"/>',
  "alert-triangle":
    '<path d="M12 4l9 16H3zM12 10v4M12 17.5h.01"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  refresh: '<path d="M20 12a8 8 0 11-2.3-5.6M20 4v5h-5"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>',
  "device-desktop":
    '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  inbox: '<path d="M4 13l3-8h10l3 8v6H4zM4 13h5l1 2h4l1-2h5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8M10 12h4"/>',
  leaf: '<path d="M5 19c8 0 14-6 14-14-8 0-14 6-14 14zM5 19l7-7"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
};
