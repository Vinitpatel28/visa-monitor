// ============================================================
// ICP Portal Selectors — Single source of truth for all selectors
// When the portal DOM changes, update THIS file only.
// Array = try each selector in order until one matches.
// ============================================================

export const ICP_SELECTORS = {
  // === Page State ===
  angularApp: '[ng-app]',
  loadingSpinner: '.loading, .spinner, [ng-show*="loading"], .overlay',

  // === Search Type Tabs ===
  passportTab: [
    'input[type="radio"][value*="passport"]',
    'label:has-text("Passport")',
    '[ng-model*="searchType"] + label:has-text("Passport")',
    'a:has-text("Passport Information")',
    'li:has-text("Passport") a',
  ],

  // === Form Fields ===
  permitType: [
    'select[ng-model*="permitType"]',
    'select[ng-model*="fileType"]',
    'select[id*="permit"]',
    'select[name*="permit"]',
  ],
  passportNumber: [
    'input[ng-model*="passportNumber"]',
    'input[ng-model*="passport"]',
    'input[placeholder*="Passport" i]',
    'input[name*="passport" i]',
    'input[id*="passport" i]',
  ],
  passportExpiry: [
    'input[ng-model*="passportExpiry"]',
    'input[ng-model*="expiryDate"]',
    'input[type="date"][ng-model*="expiry"]',
    'input[placeholder*="Expiry" i]',
    'input[name*="expiry" i]',
  ],
  nationality: [
    'select[ng-model*="nationality"]',
    'select[ng-model*="country"]',
    'select[id*="nationality"]',
    'select[name*="nationality"]',
  ],

  // === CAPTCHA ===
  captchaImage: [
    'img[src*="captcha"]',
    'img[ng-src*="captcha"]',
    '.captcha-image img',
    '.captcha img',
    'img.captcha',
  ],
  captchaInput: [
    'input[ng-model*="captcha"]',
    'input[placeholder*="captcha" i]',
    'input[placeholder*="code" i]',
    'input[name*="captcha" i]',
    'input[id*="captcha" i]',
  ],

  // === Submit ===
  searchButton: [
    'button[ng-click*="search" i]',
    'button[ng-click*="submit" i]',
    'button:has-text("Search")',
    'button:has-text("بحث")',
    'input[type="submit"]',
    'button[type="submit"]',
  ],

  // === Results ===
  resultContainer: [
    '.result-container',
    '.search-result',
    '[ng-show*="result"]',
    '[ng-if*="result"]',
    'table.result-table',
    '.results-section',
  ],
  noRecordMessage: [
    '[ng-show*="noRecord"]',
    '[ng-if*="noRecord"]',
    '.no-record',
    '.no-data',
    'div:has-text("No record found")',
    'div:has-text("لا توجد نتائج")',
  ],

  // === Result Data Fields ===
  statusField: [
    '[ng-bind*="status"]',
    '.status-value',
    'td.status',
    'span.status',
  ],
  fileNumberField: [
    '[ng-bind*="fileNumber"]',
    '.file-number-value',
    'td.file-number',
  ],
  expiryField: [
    '[ng-bind*="expiry"]',
    '.expiry-value',
    'td.expiry',
  ],
  nameField: [
    '[ng-bind*="name"]',
    '.name-value',
    'td.holder-name',
  ],
} as const;

// Type for selector keys
export type ICPSelectorKey = keyof typeof ICP_SELECTORS;

/**
 * Try each selector in the array until one matches on the page.
 * Returns the first matching selector string, or null.
 */
export function resolveSelector(key: ICPSelectorKey): string {
  const selectors = ICP_SELECTORS[key];
  if (typeof selectors === 'string') return selectors;
  // Join with comma for CSS "any of" matching
  return (selectors as readonly string[]).join(', ');
}

/**
 * Get the array of selectors for a key (for trying one by one)
 */
export function getSelectorList(key: ICPSelectorKey): string[] {
  const selectors = ICP_SELECTORS[key];
  if (typeof selectors === 'string') return [selectors];
  return [...selectors];
}
