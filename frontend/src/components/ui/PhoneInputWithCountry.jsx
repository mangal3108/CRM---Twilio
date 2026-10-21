import { useState, useEffect, useMemo, useRef } from 'react'
import { ChevronDown, Phone, Search, Check } from 'lucide-react'

export const COUNTRY_CODES = [
  { code: '+91',  country: 'India',          iso: 'IN', flag: '🇮🇳' },
  { code: '+1',   country: 'United States',  iso: 'US', flag: '🇺🇸' },
  { code: '+1',   country: 'Canada',         iso: 'CA', flag: '🇨🇦' },
  { code: '+44',  country: 'United Kingdom', iso: 'GB', flag: '🇬🇧' },
  { code: '+971', country: 'UAE',            iso: 'AE', flag: '🇦🇪' },
  { code: '+966', country: 'Saudi Arabia',   iso: 'SA', flag: '🇸🇦' },
  { code: '+61',  country: 'Australia',      iso: 'AU', flag: '🇦🇺' },
  { code: '+65',  country: 'Singapore',      iso: 'SG', flag: '🇸🇬' },
  { code: '+49',  country: 'Germany',        iso: 'DE', flag: '🇩🇪' },
  { code: '+33',  country: 'France',         iso: 'FR', flag: '🇫🇷' },
  { code: '+34',  country: 'Spain',          iso: 'ES', flag: '🇪🇸' },
  { code: '+39',  country: 'Italy',          iso: 'IT', flag: '🇮🇹' },
  { code: '+31',  country: 'Netherlands',    iso: 'NL', flag: '🇳🇱' },
  { code: '+55',  country: 'Brazil',         iso: 'BR', flag: '🇧🇷' },
  { code: '+52',  country: 'Mexico',         iso: 'MX', flag: '🇲🇽' },
  { code: '+27',  country: 'South Africa',   iso: 'ZA', flag: '🇿🇦' },
  { code: '+63',  country: 'Philippines',    iso: 'PH', flag: '🇵🇭' },
  { code: '+60',  country: 'Malaysia',       iso: 'MY', flag: '🇲🇾' },
  { code: '+62',  country: 'Indonesia',      iso: 'ID', flag: '🇮🇩' },
  { code: '+880', country: 'Bangladesh',     iso: 'BD', flag: '🇧🇩' },
  { code: '+92',  country: 'Pakistan',       iso: 'PK', flag: '🇵🇰' },
  { code: '+234', country: 'Nigeria',        iso: 'NG', flag: '🇳🇬' },
  { code: '+254', country: 'Kenya',          iso: 'KE', flag: '🇰🇪' },
  { code: '+64',  country: 'New Zealand',    iso: 'NZ', flag: '🇳🇿' },
  { code: '+353', country: 'Ireland',        iso: 'IE', flag: '🇮🇪' },
  { code: '+81',  country: 'Japan',          iso: 'JP', flag: '🇯🇵' },
]

/**
 * Parses a raw phone string into { countryCode, localNumber }
 */
export function parsePhoneNumber(raw = '', defaultCode = '+91') {
  if (!raw) return { countryCode: defaultCode, localNumber: '' }
  const clean = String(raw).trim()

  if (clean.startsWith('+')) {
    // Try matching longest country codes first (e.g. +971, +880 before +9, +1)
    const sorted = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length)
    for (const c of sorted) {
      if (clean.startsWith(c.code)) {
        const local = clean.slice(c.code.length).replace(/^[-\s]+/, '')
        return { countryCode: c.code, localNumber: local }
      }
    }
    // Fallback: extract leading +digits
    const match = clean.match(/^(\+\d{1,4})(.*)$/)
    if (match) {
      return { countryCode: match[1], localNumber: match[2].trim() }
    }
  }

  // No leading plus: if 10 digits and starts with non-plus, assume defaultCode
  return { countryCode: defaultCode, localNumber: clean }
}

export default function PhoneInputWithCountry({
  value = '',
  onChange,
  placeholder = '98765 43210',
  name = 'phone',
  required = false,
  disabled = false,
  className = '',
  defaultCountryCode = '+91',
}) {
  const [openDropdown, setOpenDropdown] = useState(false)
  const [search, setSearch] = useState('')
  const dropdownRef = useRef(null)

  // Parse incoming value
  const parsed = useMemo(() => {
    return parsePhoneNumber(value, defaultCountryCode)
  }, [value, defaultCountryCode])

  const [selectedCode, setSelectedCode] = useState(parsed.countryCode)
  const [localNumber, setLocalNumber] = useState(parsed.localNumber)

  // Keep internal state in sync when value changes from outside
  useEffect(() => {
    setSelectedCode(parsed.countryCode)
    setLocalNumber(parsed.localNumber)
  }, [parsed.countryCode, parsed.localNumber])

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpenDropdown(false)
      }
    }
    if (openDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [openDropdown])

  const activeCountry = useMemo(() => {
    return COUNTRY_CODES.find(c => c.code === selectedCode) || {
      code: selectedCode || '+91',
      country: 'Custom',
      iso: 'XX',
      flag: '🌐'
    }
  }, [selectedCode])

  const filteredCountries = useMemo(() => {
    if (!search.trim()) return COUNTRY_CODES
    const q = search.toLowerCase()
    return COUNTRY_CODES.filter(
      c => c.country.toLowerCase().includes(q) || c.code.includes(q) || c.iso.toLowerCase().includes(q)
    )
  }, [search])

  const notifyChange = (code, local) => {
    const cleanLocal = local.trim()
    if (!cleanLocal) {
      onChange?.('')
      return
    }
    // Return E.164 without internal dashes/spaces
    const sanitizedLocal = cleanLocal.replace(/[^\d]/g, '')
    const full = `${code}${sanitizedLocal}`
    onChange?.(full)
  }

  const handleCountrySelect = (code) => {
    setSelectedCode(code)
    setOpenDropdown(false)
    setSearch('')
    notifyChange(code, localNumber)
  }

  const handleNumberChange = (e) => {
    let input = e.target.value
    // If user pastes/types international format with +, auto detect
    if (input.startsWith('+')) {
      const p = parsePhoneNumber(input, selectedCode)
      setSelectedCode(p.countryCode)
      setLocalNumber(p.localNumber)
      notifyChange(p.countryCode, p.localNumber)
      return
    }

    setLocalNumber(input)
    notifyChange(selectedCode, input)
  }

  return (
    <div className={`relative flex items-center ${className}`}>
      <div className="relative flex-1 flex rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus-within:ring-2 focus-within:ring-brand-500/30 focus-within:border-brand-500 transition-all overflow-hidden shadow-sm">
        {/* Country Picker Trigger */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpenDropdown(!openDropdown)}
          className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700/80 border-r border-slate-200 dark:border-slate-700 transition-colors text-xs font-semibold text-slate-700 dark:text-slate-200 flex-shrink-0 select-none"
          title={`${activeCountry.country} (${activeCountry.code})`}
        >
          <span className="text-base leading-none">{activeCountry.flag}</span>
          <span>{activeCountry.code}</span>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-0.5" />
        </button>

        {/* Local Number Input */}
        <div className="relative flex-1 flex items-center">
          <Phone className="w-3.5 h-3.5 text-slate-400 absolute left-3 pointer-events-none" />
          <input
            type="tel"
            name={name}
            disabled={disabled}
            required={required}
            value={localNumber}
            onChange={handleNumberChange}
            placeholder={placeholder}
            className="w-full text-xs font-medium pl-8 pr-3 py-2 bg-transparent text-slate-800 dark:text-slate-100 placeholder:text-slate-400 outline-none"
          />
        </div>
      </div>

      {/* Country Code Dropdown */}
      {openDropdown && (
        <div
          ref={dropdownRef}
          className="absolute top-full left-0 mt-1.5 w-64 max-h-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-100"
        >
          {/* Search box inside dropdown */}
          <div className="p-2 border-b border-slate-100 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5" />
              <input
                type="text"
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search country or code..."
                className="w-full text-xs pl-8 pr-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>

          {/* List of Countries */}
          <div className="overflow-y-auto flex-1 custom-scrollbar py-1">
            {filteredCountries.length === 0 ? (
              <div className="p-3 text-center text-xs text-slate-400">No country found</div>
            ) : (
              filteredCountries.map((c, i) => {
                const isSelected = selectedCode === c.code && (activeCountry.iso === c.iso)
                return (
                  <button
                    key={`${c.iso}-${c.code}-${i}`}
                    type="button"
                    onClick={() => handleCountrySelect(c.code)}
                    className={`w-full flex items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-brand-50 dark:hover:bg-brand-950/30 ${
                      isSelected ? 'bg-brand-50/80 dark:bg-brand-950/40 font-bold text-brand-600 dark:text-brand-400' : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="text-base">{c.flag}</span>
                      <span className="truncate">{c.country}</span>
                    </div>
                    <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                      <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">{c.code}</span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-brand-500" />}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
