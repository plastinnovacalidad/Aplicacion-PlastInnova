/* @ds-bundle: {"format":4,"namespace":"PlastInnovaDesignSystem_ff345a","components":[{"name":"ChartPanel","sourcePath":"components/app/ChartPanel.jsx"},{"name":"CHART_COLORS","sourcePath":"components/app/ChartPanel.jsx"},{"name":"DataTable","sourcePath":"components/app/DataTable.jsx"},{"name":"KpiCard","sourcePath":"components/app/KpiCard.jsx"},{"name":"ModuleTile","sourcePath":"components/app/ModuleTile.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Tag","sourcePath":"components/core/Tag.jsx"},{"name":"Dialog","sourcePath":"components/feedback/Dialog.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"Tooltip","sourcePath":"components/feedback/Tooltip.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Radio","sourcePath":"components/forms/Radio.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Breadcrumb","sourcePath":"components/navigation/Breadcrumb.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"}],"sourceHashes":{"components/app/ChartPanel.jsx":"c4e15c06e01c","components/app/DataTable.jsx":"684c287c917b","components/app/KpiCard.jsx":"6a84841c89e7","components/app/ModuleTile.jsx":"0e850d133cd3","components/core/Badge.jsx":"3533ab388062","components/core/Button.jsx":"da3630a3a7f9","components/core/Card.jsx":"c97b3cd33c56","components/core/Icon.jsx":"5ee34ffc3f34","components/core/IconButton.jsx":"851225e81289","components/core/Tag.jsx":"7a9637bf761d","components/feedback/Dialog.jsx":"6915225a0e45","components/feedback/Toast.jsx":"214e0b1f50d0","components/feedback/Tooltip.jsx":"01a8b17e90d0","components/forms/Checkbox.jsx":"1a35d4589b11","components/forms/Input.jsx":"58a37a9f67c8","components/forms/Radio.jsx":"23a21f53d109","components/forms/Select.jsx":"d6ed351c376f","components/forms/Switch.jsx":"4ad457c088e4","components/navigation/Breadcrumb.jsx":"64796e1ae460","components/navigation/Tabs.jsx":"20011969dda3","ui_kits/portal/Chrome.jsx":"b3b05eb0ef94","ui_kits/portal/Dashboard.jsx":"9a73c00d01ae","ui_kits/portal/Portal.jsx":"2a6b769eb79c"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.PlastInnovaDesignSystem_ff345a = window.PlastInnovaDesignSystem_ff345a || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Card({
  padding = 'var(--space-6)',
  interactive = false,
  elevation = 'sm',
  bordered = true,
  children,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const shadow = {
    none: 'none',
    sm: 'var(--shadow-sm)',
    md: 'var(--shadow-md)',
    lg: 'var(--shadow-lg)'
  }[elevation];
  return /*#__PURE__*/React.createElement("div", _extends({
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      background: 'var(--surface-card)',
      border: bordered ? '1px solid var(--border-subtle)' : 'none',
      borderRadius: 'var(--radius-lg)',
      padding,
      boxShadow: interactive && hover ? 'var(--shadow-lg)' : shadow,
      transform: interactive && hover ? 'translateY(-2px)' : 'none',
      transition: 'box-shadow var(--dur-base) var(--ease-out),transform var(--dur-base) var(--ease-out)',
      cursor: interactive ? 'pointer' : undefined,
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** FontAwesome 6 glyph. `name` is the icon slug without the `fa-` prefix. */
function Icon({
  name = 'circle',
  size = 20,
  variant = 'solid',
  style,
  className = '',
  ...rest
}) {
  return /*#__PURE__*/React.createElement("i", _extends({
    "aria-hidden": "true",
    className: `fa-${variant} fa-${name} ${className}`,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: size,
      height: size,
      fontSize: Math.round(size * 0.88),
      lineHeight: 1,
      flex: 'none',
      ...style
    }
  }, rest));
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/app/ChartPanel.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Titled panel that hosts a Chart.js canvas. */
function ChartPanel({
  title,
  subtitle,
  action,
  height = 260,
  children,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      background: 'var(--surface-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-sm)',
      padding: 'var(--space-6)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 'var(--space-4)',
      marginBottom: 'var(--space-5)'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    style: {
      font: 'var(--type-h3)',
      fontSize: 'var(--fs-md)',
      color: 'var(--text-heading)'
    }
  }, title), subtitle ? /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-body-sm)',
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-muted)',
      marginTop: 2
    }
  }, subtitle) : null), action || null), /*#__PURE__*/React.createElement("div", {
    style: {
      height,
      position: 'relative'
    }
  }, children));
}

/** Chart.js palette in brand order. Pass to `backgroundColor`. */
const CHART_COLORS = ['#2c43a2', '#ff0000', '#0071bc', '#009245', '#f7931e', '#8799da', '#9aa3b2'];
Object.assign(__ds_scope, { ChartPanel, CHART_COLORS });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/app/ChartPanel.jsx", error: String((e && e.message) || e) }); }

// components/app/DataTable.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Dense report table. Columns: { key, label, align, width, render }. */
function DataTable({
  columns = [],
  rows = [],
  zebra = true,
  emptyLabel = 'Sin registros',
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(-1);
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      background: 'var(--surface-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-sm)',
      overflow: 'hidden',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      font: 'var(--type-data)'
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      background: 'var(--surface-subtle)'
    }
  }, columns.map(c => /*#__PURE__*/React.createElement("th", {
    key: c.key,
    style: {
      font: 'var(--type-data-strong)',
      fontSize: 'var(--fs-xs)',
      letterSpacing: 'var(--ls-wide)',
      textTransform: 'uppercase',
      color: 'var(--pi-neutral-600)',
      textAlign: c.align || 'left',
      padding: 'var(--space-4) var(--space-5)',
      width: c.width,
      borderBottom: '1px solid var(--border-subtle)',
      whiteSpace: 'nowrap'
    }
  }, c.label)))), /*#__PURE__*/React.createElement("tbody", null, rows.length === 0 ? /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: columns.length,
    style: {
      padding: 'var(--space-12)',
      textAlign: 'center',
      color: 'var(--text-muted)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "inbox",
    size: 24,
    style: {
      color: 'var(--pi-neutral-400)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'var(--space-3)'
    }
  }, emptyLabel))) : rows.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: i,
    onMouseEnter: () => setHover(i),
    onMouseLeave: () => setHover(-1),
    style: {
      background: hover === i ? 'var(--pi-blue-50)' : zebra && i % 2 ? 'var(--pi-neutral-50)' : 'transparent',
      transition: 'background-color var(--dur-instant) var(--ease-standard)'
    }
  }, columns.map(c => /*#__PURE__*/React.createElement("td", {
    key: c.key,
    style: {
      padding: 'var(--space-4) var(--space-5)',
      textAlign: c.align || 'left',
      color: 'var(--text-body)',
      borderBottom: '1px solid var(--border-subtle)'
    }
  }, c.render ? c.render(r[c.key], r) : r[c.key])))))));
}
Object.assign(__ds_scope, { DataTable });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/app/DataTable.jsx", error: String((e && e.message) || e) }); }

// components/app/KpiCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const TONES = {
  brand: 'var(--pi-blue-600)',
  accent: 'var(--pi-red-600)',
  success: 'var(--state-success)',
  warning: 'var(--state-warning)',
  info: 'var(--state-info)'
};

/** Single headline figure for report dashboards. */
function KpiCard({
  label,
  value,
  unit,
  icon,
  tone = 'brand',
  delta,
  deltaLabel,
  style,
  ...rest
}) {
  const c = TONES[tone] || TONES.brand;
  const up = typeof delta === 'number' && delta >= 0;
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      background: 'var(--surface-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-sm)',
      padding: 'var(--space-6)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-2)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-eyebrow)',
      letterSpacing: 'var(--ls-wide)',
      textTransform: 'uppercase',
      color: 'var(--text-muted)'
    }
  }, label), icon ? /*#__PURE__*/React.createElement("span", {
    style: {
      width: 34,
      height: 34,
      flex: 'none',
      borderRadius: 'var(--radius-md)',
      background: 'var(--pi-blue-50)',
      color: c,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 17
  })) : null), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-kpi)',
      color: 'var(--text-heading)'
    }
  }, value), unit ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-data)',
      fontSize: 'var(--fs-md)',
      color: 'var(--text-muted)'
    }
  }, unit) : null), typeof delta === 'number' ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      font: 'var(--type-data)',
      fontSize: 'var(--fs-xs)',
      color: up ? 'var(--state-success)' : 'var(--state-danger)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: up ? 'arrow-trend-up' : 'arrow-trend-down',
    size: 13
  }), up ? '+' : '', delta, "%", deltaLabel ? /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)'
    }
  }, deltaLabel) : null) : null);
}
Object.assign(__ds_scope, { KpiCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/app/KpiCard.jsx", error: String((e && e.message) || e) }); }

// components/app/ModuleTile.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Square module launcher used on the portal home. */
function ModuleTile({
  icon = 'circle',
  label,
  tone = 'var(--pi-gradient-blue)',
  size = 150,
  onClick,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("a", _extends({
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      width: size,
      background: 'var(--surface-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
      cursor: 'pointer',
      textDecoration: 'none',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: hover ? 'var(--shadow-lg)' : 'var(--shadow-sm)',
      transform: hover ? 'translateY(-4px)' : 'none',
      transition: 'box-shadow var(--dur-base) var(--ease-out),transform var(--dur-base) var(--ease-out)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      height: size,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: tone,
      color: '#fff'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 44
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--space-3) var(--space-2)',
      minHeight: 52,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-label)',
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-heading)',
      textAlign: 'center',
      lineHeight: 1.3
    }
  }, label)));
}
Object.assign(__ds_scope, { ModuleTile });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/app/ModuleTile.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const TONES = {
  brand: ['var(--pi-blue-50)', 'var(--pi-blue-700)'],
  accent: ['var(--pi-red-50)', 'var(--pi-red-700)'],
  neutral: ['var(--pi-neutral-100)', 'var(--pi-neutral-700)'],
  success: ['var(--state-success-soft)', 'var(--state-success)'],
  warning: ['var(--state-warning-soft)', '#8a4d00'],
  info: ['var(--state-info-soft)', 'var(--state-info)']
};
function Badge({
  tone = 'brand',
  solid = false,
  icon,
  children,
  style,
  ...rest
}) {
  const [bg, fg] = TONES[tone] || TONES.brand;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 10px',
      borderRadius: 'var(--radius-pill)',
      background: solid ? fg : bg,
      color: solid ? '#fff' : fg,
      font: 'var(--type-eyebrow)',
      letterSpacing: 'var(--ls-wide)',
      textTransform: 'uppercase',
      ...style
    }
  }, rest), icon ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 12
  }) : null, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SIZES = {
  sm: {
    h: 'var(--control-h-sm)',
    px: '14px',
    fs: 'var(--fs-xs)',
    icon: 14,
    gap: '6px'
  },
  md: {
    h: 'var(--control-h-md)',
    px: '20px',
    fs: 'var(--fs-sm)',
    icon: 16,
    gap: '8px'
  },
  lg: {
    h: 'var(--control-h-lg)',
    px: '28px',
    fs: 'var(--fs-md)',
    icon: 18,
    gap: '10px'
  }
};
const VARIANTS = {
  primary: {
    background: 'var(--pi-blue-600)',
    color: 'var(--text-on-brand)',
    border: '1px solid transparent',
    boxShadow: 'var(--shadow-sm)'
  },
  accent: {
    background: 'var(--pi-gradient-red)',
    color: 'var(--text-on-accent)',
    border: '1px solid transparent',
    boxShadow: 'var(--shadow-accent)'
  },
  secondary: {
    background: 'transparent',
    color: 'var(--pi-blue-600)',
    border: '1.5px solid var(--pi-blue-600)',
    boxShadow: 'none'
  },
  subtle: {
    background: 'var(--pi-blue-50)',
    color: 'var(--pi-blue-700)',
    border: '1px solid transparent',
    boxShadow: 'none'
  },
  ghost: {
    background: 'transparent',
    color: 'var(--text-body)',
    border: '1px solid transparent',
    boxShadow: 'none'
  }
};
const HOVER = {
  primary: {
    background: 'var(--pi-blue-700)'
  },
  accent: {
    background: 'var(--pi-red-700)'
  },
  secondary: {
    background: 'var(--pi-blue-50)'
  },
  subtle: {
    background: 'var(--pi-blue-100)'
  },
  ghost: {
    background: 'var(--pi-neutral-100)'
  }
};
function Button({
  variant = 'primary',
  size = 'md',
  iconLeft,
  iconRight,
  fullWidth = false,
  disabled = false,
  children,
  style,
  onClick,
  type = 'button',
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const [down, setDown] = React.useState(false);
  const s = SIZES[size] || SIZES.md;
  const v = VARIANTS[variant] || VARIANTS.primary;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setDown(false);
    },
    onMouseDown: () => setDown(true),
    onMouseUp: () => setDown(false),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: s.gap,
      height: s.h,
      padding: `0 ${s.px}`,
      width: fullWidth ? '100%' : undefined,
      font: 'var(--type-button)',
      fontSize: s.fs,
      letterSpacing: 'var(--ls-wide)',
      textTransform: 'uppercase',
      borderRadius: 'var(--radius-pill)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'var(--transition-control)',
      whiteSpace: 'nowrap',
      opacity: disabled ? 0.45 : 1,
      transform: down && !disabled ? 'scale(.97)' : 'scale(1)',
      ...v,
      ...(hover && !disabled ? HOVER[variant] : null),
      ...style
    }
  }, rest), iconLeft ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: iconLeft,
    size: s.icon
  }) : null, children, iconRight ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: iconRight,
    size: s.icon
  }) : null);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SIZES = {
  sm: [32, 16],
  md: [40, 18],
  lg: [48, 22]
};
function IconButton({
  icon = 'circle',
  size = 'md',
  variant = 'ghost',
  label,
  disabled = false,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const [box, glyph] = SIZES[size] || SIZES.md;
  const base = {
    ghost: {
      background: 'transparent',
      color: 'var(--text-body)',
      hover: 'var(--pi-neutral-100)'
    },
    solid: {
      background: 'var(--pi-blue-600)',
      color: '#fff',
      hover: 'var(--pi-blue-700)'
    },
    accent: {
      background: 'var(--pi-red-600)',
      color: '#fff',
      hover: 'var(--pi-red-700)'
    },
    outline: {
      background: 'transparent',
      color: 'var(--pi-blue-600)',
      hover: 'var(--pi-blue-50)',
      border: '1.5px solid var(--border-subtle)'
    }
  }[variant];
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    "aria-label": label,
    disabled: disabled,
    title: label,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: box,
      height: box,
      borderRadius: 'var(--radius-pill)',
      border: base.border || '1px solid transparent',
      background: hover && !disabled ? base.hover : base.background,
      color: base.color,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.45 : 1,
      transition: 'var(--transition-control)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: glyph
  }));
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Tag.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Tag({
  children,
  selected = false,
  onRemove,
  onClick,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("span", _extends({
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      height: '32px',
      padding: '0 14px',
      borderRadius: 'var(--radius-pill)',
      font: 'var(--type-label)',
      background: selected ? 'var(--pi-blue-600)' : hover ? 'var(--pi-neutral-100)' : 'var(--pi-white)',
      color: selected ? '#fff' : 'var(--text-body)',
      border: `1px solid ${selected ? 'var(--pi-blue-600)' : 'var(--border-default)'}`,
      cursor: onClick ? 'pointer' : 'default',
      transition: 'var(--transition-control)',
      ...style
    }
  }, rest), children, onRemove ? /*#__PURE__*/React.createElement("span", {
    onClick: e => {
      e.stopPropagation();
      onRemove(e);
    },
    style: {
      display: 'inline-flex',
      cursor: 'pointer',
      opacity: 0.7
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "xmark",
    size: 13
  })) : null);
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tag.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Dialog.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Dialog({
  open = false,
  title,
  description,
  onClose,
  footer,
  width = 460,
  children,
  style,
  ...rest
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      zIndex: 60,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(17,27,67,.45)',
      backdropFilter: 'blur(3px)',
      WebkitBackdropFilter: 'blur(3px)',
      padding: 'var(--space-6)'
    },
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", _extends({
    role: "dialog",
    "aria-modal": "true",
    onClick: e => e.stopPropagation(),
    style: {
      width: '100%',
      maxWidth: width,
      background: 'var(--surface-card)',
      borderRadius: 'var(--radius-xl)',
      boxShadow: 'var(--shadow-xl)',
      overflow: 'hidden',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 'var(--space-4)',
      padding: 'var(--space-6) var(--space-6) var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, title ? /*#__PURE__*/React.createElement("h3", {
    style: {
      font: 'var(--type-h3)',
      color: 'var(--text-heading)'
    }
  }, title) : null, description ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '6px 0 0',
      font: 'var(--type-body-sm)',
      color: 'var(--text-muted)'
    }
  }, description) : null), /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    icon: "xmark",
    label: "Cerrar",
    size: "sm",
    onClick: onClose
  })), children ? /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '0 var(--space-6)'
    }
  }, children) : null, footer ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 'var(--space-3)',
      padding: 'var(--space-6)',
      marginTop: 'var(--space-2)'
    }
  }, footer) : /*#__PURE__*/React.createElement("div", {
    style: {
      height: 'var(--space-6)'
    }
  })));
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const TONES = {
  success: {
    icon: 'circle-check',
    color: 'var(--state-success)'
  },
  danger: {
    icon: 'circle-exclamation',
    color: 'var(--state-danger)'
  },
  info: {
    icon: 'circle-info',
    color: 'var(--state-info)'
  },
  warning: {
    icon: 'triangle-exclamation',
    color: 'var(--state-warning)'
  }
};
function Toast({
  tone = 'success',
  title,
  message,
  onClose,
  style,
  ...rest
}) {
  const t = TONES[tone] || TONES.info;
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "status",
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 'var(--space-3)',
      minWidth: '300px',
      maxWidth: '420px',
      padding: 'var(--space-4)',
      background: 'var(--surface-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-lg)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: t.icon,
    size: 20,
    style: {
      color: t.color,
      marginTop: '1px'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, title ? /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-label)',
      color: 'var(--text-heading)'
    }
  }, title) : null, message ? /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-body-sm)',
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-muted)',
      marginTop: '2px'
    }
  }, message) : null), onClose ? /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    icon: "xmark",
    label: "Cerrar",
    size: "sm",
    onClick: onClose
  }) : null);
}
Object.assign(__ds_scope, { Toast });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Tooltip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Tooltip({
  content,
  placement = 'top',
  children,
  style,
  ...rest
}) {
  const [open, setOpen] = React.useState(false);
  const pos = {
    top: {
      bottom: '100%',
      left: '50%',
      transform: 'translate(-50%,-8px)'
    },
    bottom: {
      top: '100%',
      left: '50%',
      transform: 'translate(-50%,8px)'
    },
    left: {
      right: '100%',
      top: '50%',
      transform: 'translate(-8px,-50%)'
    },
    right: {
      left: '100%',
      top: '50%',
      transform: 'translate(8px,-50%)'
    }
  }[placement];
  return /*#__PURE__*/React.createElement("span", _extends({
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
    style: {
      position: 'relative',
      display: 'inline-flex',
      ...style
    }
  }, rest), children, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      ...pos,
      zIndex: 50,
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
      padding: '6px 10px',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--pi-blue-900)',
      color: '#fff',
      font: 'var(--type-body-sm)',
      fontSize: 'var(--fs-xs)',
      boxShadow: 'var(--shadow-md)',
      opacity: open ? 1 : 0,
      transition: 'opacity var(--dur-fast) var(--ease-standard)'
    }
  }, content));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Tooltip.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Checkbox({
  label,
  checked,
  defaultChecked,
  onChange,
  disabled = false,
  style,
  ...rest
}) {
  const controlled = checked !== undefined;
  const [inner, setInner] = React.useState(!!defaultChecked);
  const on = controlled ? checked : inner;
  const toggle = () => {
    if (disabled) return;
    if (!controlled) setInner(!on);
    onChange && onChange(!on);
  };
  return /*#__PURE__*/React.createElement("label", _extends({
    onClick: toggle,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '10px',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '20px',
      height: '20px',
      flex: 'none',
      borderRadius: 'var(--radius-xs)',
      background: on ? 'var(--pi-blue-600)' : 'var(--pi-white)',
      border: `1.5px solid ${on ? 'var(--pi-blue-600)' : 'var(--border-default)'}`,
      color: '#fff',
      transition: 'var(--transition-control)'
    }
  }, on ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "check",
    size: 13
  }) : null), label ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-body-sm)',
      color: 'var(--text-body)'
    }
  }, label) : null);
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Input({
  label,
  hint,
  error,
  iconLeft,
  size = 'md',
  disabled = false,
  id,
  style,
  wrapperStyle,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const uid = id || React.useId();
  const h = {
    sm: 'var(--control-h-sm)',
    md: 'var(--control-h-md)',
    lg: 'var(--control-h-lg)'
  }[size];
  const borderColor = error ? 'var(--state-danger)' : focus ? 'var(--pi-blue-600)' : 'var(--border-default)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      ...wrapperStyle
    }
  }, label ? /*#__PURE__*/React.createElement("label", {
    htmlFor: uid,
    style: {
      font: 'var(--type-label)',
      color: 'var(--text-heading)'
    }
  }, label) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      height: h,
      padding: '0 14px',
      background: disabled ? 'var(--surface-sunken)' : 'var(--pi-white)',
      border: `1px solid ${borderColor}`,
      borderRadius: 'var(--radius-md)',
      boxShadow: focus ? error ? 'var(--focus-ring-accent)' : 'var(--focus-ring)' : 'none',
      transition: 'var(--transition-control)',
      opacity: disabled ? 0.6 : 1
    }
  }, iconLeft ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: iconLeft,
    size: 16,
    style: {
      color: 'var(--text-muted)'
    }
  }) : null, /*#__PURE__*/React.createElement("input", _extends({
    id: uid,
    disabled: disabled,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      flex: 1,
      minWidth: 0,
      border: 'none',
      outline: 'none',
      background: 'transparent',
      font: 'var(--type-body)',
      fontSize: size === 'sm' ? 'var(--fs-sm)' : 'var(--fs-md)',
      color: 'var(--text-heading)',
      ...style
    }
  }, rest))), error || hint ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-body-sm)',
      fontSize: 'var(--fs-xs)',
      color: error ? 'var(--state-danger)' : 'var(--text-muted)'
    }
  }, error || hint) : null);
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Radio.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Radio({
  label,
  checked = false,
  onChange,
  name,
  value,
  disabled = false,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", _extends({
    onClick: () => !disabled && onChange && onChange(value),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '10px',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '20px',
      height: '20px',
      flex: 'none',
      borderRadius: 'var(--radius-pill)',
      background: 'var(--pi-white)',
      border: `1.5px solid ${checked ? 'var(--pi-blue-600)' : 'var(--border-default)'}`,
      transition: 'var(--transition-control)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '10px',
      height: '10px',
      borderRadius: 'var(--radius-pill)',
      background: 'var(--pi-blue-600)',
      transform: checked ? 'scale(1)' : 'scale(0)',
      transition: 'transform var(--dur-fast) var(--ease-out)'
    }
  })), label ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-body-sm)',
      color: 'var(--text-body)'
    }
  }, label) : null, /*#__PURE__*/React.createElement("input", {
    type: "radio",
    name: name,
    value: value,
    checked: checked,
    readOnly: true,
    style: {
      display: 'none'
    }
  }));
}
Object.assign(__ds_scope, { Radio });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Radio.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Select({
  label,
  hint,
  options = [],
  size = 'md',
  disabled = false,
  id,
  style,
  wrapperStyle,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const uid = id || React.useId();
  const h = {
    sm: 'var(--control-h-sm)',
    md: 'var(--control-h-md)',
    lg: 'var(--control-h-lg)'
  }[size];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      ...wrapperStyle
    }
  }, label ? /*#__PURE__*/React.createElement("label", {
    htmlFor: uid,
    style: {
      font: 'var(--type-label)',
      color: 'var(--text-heading)'
    }
  }, label) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      height: h,
      border: `1px solid ${focus ? 'var(--pi-blue-600)' : 'var(--border-default)'}`,
      borderRadius: 'var(--radius-md)',
      background: disabled ? 'var(--surface-sunken)' : 'var(--pi-white)',
      boxShadow: focus ? 'var(--focus-ring)' : 'none',
      transition: 'var(--transition-control)',
      opacity: disabled ? 0.6 : 1
    }
  }, /*#__PURE__*/React.createElement("select", _extends({
    id: uid,
    disabled: disabled,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      appearance: 'none',
      WebkitAppearance: 'none',
      flex: 1,
      height: '100%',
      padding: '0 38px 0 14px',
      border: 'none',
      outline: 'none',
      background: 'transparent',
      font: 'var(--type-body)',
      fontSize: size === 'sm' ? 'var(--fs-sm)' : 'var(--fs-md)',
      color: 'var(--text-heading)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      ...style
    }
  }, rest), options.map(o => {
    const value = typeof o === 'string' ? o : o.value;
    const lab = typeof o === 'string' ? o : o.label;
    return /*#__PURE__*/React.createElement("option", {
      key: value,
      value: value
    }, lab);
  })), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-down",
    size: 16,
    style: {
      position: 'absolute',
      right: '14px',
      color: 'var(--text-muted)',
      pointerEvents: 'none'
    }
  })), hint ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-body-sm)',
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-muted)'
    }
  }, hint) : null);
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Switch({
  label,
  checked,
  defaultChecked,
  onChange,
  disabled = false,
  style,
  ...rest
}) {
  const controlled = checked !== undefined;
  const [inner, setInner] = React.useState(!!defaultChecked);
  const on = controlled ? checked : inner;
  const toggle = () => {
    if (disabled) return;
    if (!controlled) setInner(!on);
    onChange && onChange(!on);
  };
  return /*#__PURE__*/React.createElement("label", _extends({
    onClick: toggle,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '12px',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      width: '44px',
      height: '24px',
      flex: 'none',
      borderRadius: 'var(--radius-pill)',
      background: on ? 'var(--pi-blue-600)' : 'var(--pi-neutral-300)',
      transition: 'background-color var(--dur-fast) var(--ease-standard)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: '3px',
      left: on ? '23px' : '3px',
      width: '18px',
      height: '18px',
      borderRadius: 'var(--radius-pill)',
      background: '#fff',
      boxShadow: 'var(--shadow-sm)',
      transition: 'left var(--dur-fast) var(--ease-out)'
    }
  })), label ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-body-sm)',
      color: 'var(--text-body)'
    }
  }, label) : null);
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Breadcrumb.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Breadcrumb({
  items = [],
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("nav", _extends({
    "aria-label": "Ruta",
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      flexWrap: 'wrap',
      ...style
    }
  }, rest), items.map((it, i) => {
    const label = it.label || it;
    const last = i === items.length - 1;
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: label
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        font: 'var(--type-body-sm)',
        fontSize: 'var(--fs-xs)',
        color: last ? 'var(--text-heading)' : 'var(--text-muted)',
        fontWeight: last ? 'var(--fw-medium)' : 'var(--fw-regular)',
        cursor: last ? 'default' : 'pointer'
      }
    }, label), last ? null : /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: "chevron-right",
      size: 12,
      style: {
        color: 'var(--pi-neutral-400)'
      }
    }));
  }));
}
Object.assign(__ds_scope, { Breadcrumb });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Breadcrumb.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Tabs({
  items = [],
  value,
  defaultValue,
  onChange,
  variant = 'underline',
  style,
  ...rest
}) {
  const controlled = value !== undefined;
  const first = items[0] && (items[0].value || items[0]);
  const [inner, setInner] = React.useState(defaultValue ?? first);
  const active = controlled ? value : inner;
  const pick = v => {
    if (!controlled) setInner(v);
    onChange && onChange(v);
  };
  const pill = variant === 'pill';
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "tablist",
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: pill ? '6px' : 'var(--space-6)',
      padding: pill ? '4px' : 0,
      background: pill ? 'var(--surface-sunken)' : 'transparent',
      borderRadius: pill ? 'var(--radius-pill)' : 0,
      borderBottom: pill ? 'none' : '1px solid var(--border-subtle)',
      ...style
    }
  }, rest), items.map(it => {
    const v = it.value || it;
    const label = it.label || it;
    const on = v === active;
    return /*#__PURE__*/React.createElement("button", {
      key: v,
      role: "tab",
      "aria-selected": on,
      onClick: () => pick(v),
      style: {
        appearance: 'none',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        font: 'var(--type-label)',
        fontSize: 'var(--fs-sm)',
        padding: pill ? '8px 18px' : '0 0 12px',
        border: 'none',
        background: pill && on ? 'var(--pi-white)' : 'transparent',
        borderRadius: pill ? 'var(--radius-pill)' : 0,
        boxShadow: pill && on ? 'var(--shadow-sm)' : 'none',
        color: on ? 'var(--pi-blue-700)' : 'var(--text-muted)',
        borderBottom: pill ? 'none' : `2px solid ${on ? 'var(--pi-red-600)' : 'transparent'}`,
        marginBottom: pill ? 0 : '-1px',
        transition: 'var(--transition-control)'
      }
    }, label);
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// ui_kits/portal/Chrome.jsx
try { (() => {
const {
  Icon,
  Button,
  IconButton,
  Input
} = window.PlastInnovaDesignSystem_ff345a;
function AppHeader({
  user,
  rol,
  onHome,
  onLogout,
  canGestion = true
}) {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      background: 'var(--pi-gradient-blue)',
      color: '#fff',
      boxShadow: 'var(--shadow-md)',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--space-5) var(--space-10)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 'var(--space-8)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-4)',
      minWidth: 0,
      cursor: 'pointer'
    },
    onClick: onHome
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo-horizontal-ng.png",
    alt: "Plast Innova",
    style: {
      height: 34,
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 1,
      height: 34,
      background: 'rgba(255,255,255,.25)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      font: 'var(--type-h3)',
      fontSize: 'var(--fs-lg)',
      color: '#fff',
      whiteSpace: 'nowrap'
    }
  }, "Sistema de Calidad y Control"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--type-body-sm)',
      fontSize: 'var(--fs-xs)',
      color: 'rgba(255,255,255,.78)',
      margin: '2px 0 0',
      whiteSpace: 'nowrap'
    }
  }, "Plataforma centralizada \xB7 Circuitos SMD & Garant\xEDas"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      padding: '6px 6px 6px 14px',
      borderRadius: 'var(--radius-pill)',
      background: 'rgba(255,255,255,.12)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'right',
      lineHeight: 1.2
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-label)',
      fontSize: 'var(--fs-xs)',
      color: '#fff'
    }
  }, user), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-body-sm)',
      fontSize: 'var(--fs-2xs)',
      color: 'rgba(255,255,255,.72)'
    }
  }, rol)), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 30,
      height: 30,
      borderRadius: 'var(--radius-pill)',
      background: 'rgba(255,255,255,.9)',
      color: 'var(--pi-blue-700)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "user",
    size: 15
  }))), canGestion && /*#__PURE__*/React.createElement(IconButton, {
    icon: "gear",
    label: "Gesti\xF3n y permisos",
    style: {
      color: '#fff',
      background: 'rgba(255,255,255,.12)'
    }
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    iconLeft: "right-from-bracket",
    onClick: onLogout,
    style: {
      color: '#fff',
      background: 'rgba(255,255,255,.12)'
    }
  }, "Cerrar sesi\xF3n"))));
}
function Login({
  onLogin
}) {
  const [err, setErr] = React.useState('');
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      background: 'var(--pi-gradient-blue)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100,
      padding: 'var(--space-6)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 400,
      background: '#fff',
      borderRadius: 'var(--radius-xl)',
      boxShadow: 'var(--shadow-xl)',
      padding: 'var(--space-10)'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo-horizontal.png",
    alt: "Plast Innova",
    style: {
      height: 42,
      display: 'block',
      margin: '0 auto'
    }
  }), /*#__PURE__*/React.createElement("h2", {
    style: {
      font: 'var(--type-h2)',
      fontSize: 'var(--fs-2xl)',
      textAlign: 'center',
      marginTop: 'var(--space-8)'
    }
  }, "Bienvenido"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--type-body-sm)',
      color: 'var(--text-muted)',
      textAlign: 'center',
      margin: 'var(--space-2) 0 var(--space-8)'
    }
  }, "Sistema Integrado de Calidad y Circuitos"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Usuario",
    iconLeft: "user",
    placeholder: "tu.usuario",
    defaultValue: "j.ramirez"
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Contrase\xF1a",
    iconLeft: "lock",
    type: "password",
    defaultValue: "********"
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    fullWidth: true,
    iconRight: "arrow-right",
    onClick: onLogin,
    style: {
      marginTop: 'var(--space-2)'
    }
  }, "Ingresar al sistema"), err && /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-body-sm)',
      color: 'var(--state-danger)',
      textAlign: 'center'
    }
  }, err)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 'var(--space-8)',
      font: 'var(--type-body-sm)',
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-muted)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "shield-halved",
    size: 13
  }), " Acceso restringido a personal autorizado")));
}
Object.assign(window, {
  AppHeader,
  Login
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/portal/Chrome.jsx", error: String((e && e.message) || e) }); }

// ui_kits/portal/Dashboard.jsx
try { (() => {
const {
  KpiCard,
  DataTable,
  ChartPanel,
  CHART_COLORS,
  Badge,
  Button,
  Select,
  Tabs,
  Breadcrumb,
  Icon,
  Tag
} = window.PlastInnovaDesignSystem_ff345a;
const FILAS = [{
  fecha: '26/08/2026',
  ref: '0111-Am-Mul-V4',
  lote: '20260824',
  cant: 1200,
  aql: '1,0',
  defectos: 3,
  estado: 'Aceptado',
  insp: 'J. Ramírez'
}, {
  fecha: '26/08/2026',
  ref: 'TAR-1001P-AB-Mul',
  lote: '20260825',
  cant: 800,
  aql: '2,5',
  defectos: 14,
  estado: 'Rechazado',
  insp: 'L. Cardona'
}, {
  fecha: '25/08/2026',
  ref: 'Cir-1005-V4',
  lote: '20260826',
  cant: 2400,
  aql: '1,0',
  defectos: 5,
  estado: 'Aceptado',
  insp: 'J. Ramírez'
}, {
  fecha: '25/08/2026',
  ref: '0111-Ro-Sim-V2',
  lote: '20260819',
  cant: 600,
  aql: '1,0',
  defectos: 1,
  estado: 'Aceptado',
  insp: 'M. Ospina'
}, {
  fecha: '24/08/2026',
  ref: 'TAR-2003-CD-Mul',
  lote: '20260818',
  cant: 1500,
  aql: '4,0',
  defectos: 22,
  estado: 'Rechazado',
  insp: 'L. Cardona'
}, {
  fecha: '24/08/2026',
  ref: 'Cir-1010-V1',
  lote: '20260817',
  cant: 950,
  aql: '2,5',
  defectos: 6,
  estado: 'Aceptado',
  insp: 'M. Ospina'
}, {
  fecha: '23/08/2026',
  ref: '0111-Am-Mul-V3',
  lote: '20260814',
  cant: 1200,
  aql: '1,0',
  defectos: 2,
  estado: 'Aceptado',
  insp: 'J. Ramírez'
}];
const COLS = [{
  key: 'fecha',
  label: 'Fecha',
  width: 100
}, {
  key: 'ref',
  label: 'Referencia'
}, {
  key: 'lote',
  label: 'Lote',
  width: 110
}, {
  key: 'cant',
  label: 'Cantidad',
  align: 'right',
  width: 90,
  render: v => v.toLocaleString('es-CO')
}, {
  key: 'aql',
  label: 'AQL',
  align: 'right',
  width: 70
}, {
  key: 'defectos',
  label: 'Defectos',
  align: 'right',
  width: 90
}, {
  key: 'estado',
  label: 'Resultado',
  width: 130,
  render: v => /*#__PURE__*/React.createElement(Badge, {
    tone: v === 'Aceptado' ? 'success' : 'accent',
    solid: v !== 'Aceptado',
    icon: v === 'Aceptado' ? 'check' : 'xmark'
  }, v)
}, {
  key: 'insp',
  label: 'Inspector',
  width: 130
}];
function Bars({
  data,
  labels
}) {
  const max = Math.max(...data);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: 10,
      height: '100%'
    }
  }, data.map((v, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 6,
      height: '100%',
      justifyContent: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-data)',
      fontSize: 'var(--fs-2xs)',
      color: 'var(--text-muted)'
    }
  }, v), /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      height: v / max * 100 + '%',
      background: 'var(--pi-blue-600)',
      borderRadius: '4px 4px 0 0'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-data)',
      fontSize: 'var(--fs-2xs)',
      color: 'var(--text-muted)'
    }
  }, labels[i]))));
}
function Donut({
  slices
}) {
  const total = slices.reduce((a, s) => a + s.v, 0);
  let acc = 0;
  const stops = slices.map((s, i) => {
    const from = acc / total * 360;
    acc += s.v;
    const to = acc / total * 360;
    return `${s.c} ${from}deg ${to}deg`;
  }).join(',');
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-8)',
      height: '100%'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 150,
      height: 150,
      flex: 'none',
      borderRadius: '50%',
      background: `conic-gradient(${stops})`,
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 38,
      borderRadius: '50%',
      background: '#fff',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-data-strong)',
      fontSize: 'var(--fs-xl)',
      color: 'var(--text-heading)'
    }
  }, total), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-body-sm)',
      fontSize: 'var(--fs-2xs)',
      color: 'var(--text-muted)'
    }
  }, "lotes"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)'
    }
  }, slices.map(s => /*#__PURE__*/React.createElement("div", {
    key: s.l,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 11,
      height: 11,
      borderRadius: 3,
      background: s.c,
      flex: 'none'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-data)',
      color: 'var(--text-body)',
      minWidth: 120
    }
  }, s.l), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-data-strong)',
      color: 'var(--text-heading)'
    }
  }, Math.round(s.v / total * 100), "%")))));
}
function Dashboard({
  onHome
}) {
  const [periodo, setPeriodo] = React.useState('Mes');
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1400,
      margin: '0 auto',
      padding: 'var(--space-8) var(--space-8) var(--space-20)',
      width: '100%'
    }
  }, /*#__PURE__*/React.createElement(Breadcrumb, {
    items: ['Portal', 'Reportes', 'Tablero de Garantías']
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 'var(--space-8)',
      marginTop: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      font: 'var(--type-h1)',
      fontSize: 'var(--fs-4xl)'
    }
  }, "Tablero de Garant\xEDas"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--type-body)',
      color: 'var(--text-muted)',
      marginTop: 'var(--space-2)'
    }
  }, "Consolidado de inspecciones y garant\xEDas \xB7 actualizado hoy 08:40")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    variant: "pill",
    items: ['Semana', 'Mes', 'Año'],
    value: periodo,
    onChange: setPeriodo
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    iconLeft: "file-pdf"
  }, "Exportar PDF"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    iconLeft: "rotate-right"
  }, "Actualizar"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      marginTop: 'var(--space-8)',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-label)',
      color: 'var(--text-muted)'
    }
  }, "Filtros"), /*#__PURE__*/React.createElement(Select, {
    options: ['Todas las líneas', 'Circuitos SMD', 'Piezas plásticas'],
    size: "sm",
    wrapperStyle: {
      width: 200
    }
  }), /*#__PURE__*/React.createElement(Select, {
    options: ['Todos los inspectores', 'J. Ramírez', 'L. Cardona', 'M. Ospina'],
    size: "sm",
    wrapperStyle: {
      width: 210
    }
  }), /*#__PURE__*/React.createElement(Tag, {
    selected: true,
    onRemove: () => {}
  }, "Agosto 2026"), /*#__PURE__*/React.createElement(Tag, {
    onRemove: () => {}
  }, "AQL 1,0")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4,1fr)',
      gap: 'var(--space-5)',
      marginTop: 'var(--space-6)'
    }
  }, /*#__PURE__*/React.createElement(KpiCard, {
    label: "Lotes inspeccionados",
    value: "1.284",
    icon: "clipboard-list",
    delta: 12,
    deltaLabel: "vs. mes anterior"
  }), /*#__PURE__*/React.createElement(KpiCard, {
    label: "Lotes aceptados",
    value: "1.096",
    icon: "circle-check",
    tone: "success",
    delta: 4,
    deltaLabel: "vs. mes anterior"
  }), /*#__PURE__*/React.createElement(KpiCard, {
    label: "Lotes rechazados",
    value: "188",
    icon: "circle-xmark",
    tone: "accent",
    delta: -7,
    deltaLabel: "vs. mes anterior"
  }), /*#__PURE__*/React.createElement(KpiCard, {
    label: "Tasa de rechazo",
    value: "14,6",
    unit: "%",
    icon: "gauge-high",
    tone: "info"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.35fr 1fr',
      gap: 'var(--space-5)',
      marginTop: 'var(--space-5)'
    }
  }, /*#__PURE__*/React.createElement(ChartPanel, {
    title: "Lotes inspeccionados por mes",
    subtitle: "\xDAltimos 8 meses",
    height: 230,
    action: /*#__PURE__*/React.createElement(Select, {
      options: ['2026', '2025'],
      size: "sm",
      wrapperStyle: {
        width: 110
      }
    })
  }, /*#__PURE__*/React.createElement(Bars, {
    data: [86, 102, 94, 131, 118, 146, 139, 168],
    labels: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago']
  })), /*#__PURE__*/React.createElement(ChartPanel, {
    title: "Motivo de rechazo",
    subtitle: "Agosto 2026",
    height: 230
  }, /*#__PURE__*/React.createElement(Donut, {
    slices: [{
      l: 'Soldadura fría',
      v: 64,
      c: CHART_COLORS[0]
    }, {
      l: 'Componente ausente',
      v: 48,
      c: CHART_COLORS[1]
    }, {
      l: 'Dimensional',
      v: 41,
      c: CHART_COLORS[2]
    }, {
      l: 'Cableado',
      v: 35,
      c: CHART_COLORS[3]
    }]
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      marginTop: 'var(--space-10)',
      marginBottom: 'var(--space-5)'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-eyebrow)',
      letterSpacing: 'var(--ls-widest)',
      textTransform: 'uppercase',
      color: 'var(--pi-red-700)'
    }
  }, "Detalle"), /*#__PURE__*/React.createElement("h2", {
    style: {
      font: 'var(--type-h2)',
      fontSize: 'var(--fs-2xl)',
      marginTop: 'var(--space-2)'
    }
  }, "\xDAltimas inspecciones")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--type-data)',
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-muted)'
    }
  }, "Mostrando 7 de 1.284"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    iconRight: "arrow-right"
  }, "Ver todas"))), /*#__PURE__*/React.createElement(DataTable, {
    columns: COLS,
    rows: FILAS
  }));
}
Object.assign(window, {
  Dashboard
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/portal/Dashboard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/portal/Portal.jsx
try { (() => {
const {
  ModuleTile,
  Icon,
  Badge
} = window.PlastInnovaDesignSystem_ff345a;
const SECCIONES = [{
  id: 'electronica',
  titulo: 'Electrónica',
  icono: 'bolt',
  nota: 'Captura y consulta de circuitos',
  modulos: [{
    icon: 'bolt',
    label: 'Módulo Circuitos SMD',
    tone: 'var(--pi-gradient-blue)'
  }, {
    icon: 'plug',
    label: 'Valores y Cableado',
    tone: 'linear-gradient(135deg,#22272f 0%,#12151a 100%)'
  }, {
    icon: 'plus',
    label: 'Crear Referencia',
    tone: 'linear-gradient(135deg,#0f766e 0%,#115e59 100%)'
  }]
}, {
  id: 'piezas',
  titulo: 'Piezas Plásticas',
  icono: 'ruler-combined',
  nota: 'Dimensional y planos de molde',
  modulos: [{
    icon: 'ruler-combined',
    label: 'Metrología y Planos de Molde',
    tone: 'linear-gradient(135deg,#0071bc 0%,#005e9c 100%)'
  }, {
    icon: 'plus',
    label: 'Crear Referencia (Planos)',
    tone: 'linear-gradient(135deg,#0f766e 0%,#115e59 100%)'
  }]
}, {
  id: 'reportes',
  titulo: 'Reportes',
  icono: 'chart-column',
  nota: 'Indicadores y consolidados',
  modulos: [{
    icon: 'clipboard-list',
    label: 'Tablero de Garantías',
    tone: 'var(--pi-gradient-red)',
    view: 'dashboard'
  }]
}, {
  id: 'calidad',
  titulo: 'Calidad',
  icono: 'award',
  nota: 'Inspección, muestreo y garantías',
  modulos: [{
    icon: 'award',
    label: 'Calidad General',
    tone: 'linear-gradient(135deg,#b7791f 0%,#975a16 100%)'
  }, {
    icon: 'file-arrow-up',
    label: 'Cargar Garantías',
    tone: 'var(--pi-gradient-red)'
  }, {
    icon: 'flask',
    label: 'Muestreos ISO 2859-1',
    tone: 'linear-gradient(135deg,#009245 0%,#00742f 100%)'
  }]
}, {
  id: 'whatsapp',
  titulo: 'Bot WhatsApp',
  icono: 'comment-dots',
  nota: 'Registros recibidos por chat',
  modulos: [{
    icon: 'whatsapp',
    label: 'Control de Registros WhatsApp',
    tone: 'linear-gradient(135deg,#25D366 0%,#128C7E 100%)'
  }]
}];
function Portal({
  onOpen
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1180,
      margin: '0 auto',
      padding: 'var(--space-12) var(--space-8) var(--space-20)',
      width: '100%'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      marginBottom: 'var(--space-12)'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      font: 'var(--type-h2)'
    }
  }, "Seleccione un m\xF3dulo de trabajo"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--type-body)',
      color: 'var(--text-muted)',
      marginTop: 'var(--space-2)'
    }
  }, "Solo se muestran los m\xF3dulos habilitados para tu rol.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-12)'
    }
  }, SECCIONES.map(s => /*#__PURE__*/React.createElement("section", {
    key: s.id
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-4)',
      paddingBottom: 'var(--space-4)',
      marginBottom: 'var(--space-6)',
      borderBottom: '2px solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 36,
      height: 36,
      flex: 'none',
      borderRadius: 'var(--radius-md)',
      background: 'var(--pi-blue-50)',
      color: 'var(--pi-blue-600)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: s.icono,
    size: 17
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-eyebrow)',
      letterSpacing: 'var(--ls-widest)',
      textTransform: 'uppercase',
      color: 'var(--text-heading)',
      fontSize: 'var(--fs-sm)'
    }
  }, s.titulo), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--type-body-sm)',
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-muted)',
      marginTop: 2
    }
  }, s.nota)), /*#__PURE__*/React.createElement(Badge, {
    tone: "neutral"
  }, s.modulos.length, " ", s.modulos.length === 1 ? 'módulo' : 'módulos')), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 'var(--space-5)'
    }
  }, s.modulos.map(m => /*#__PURE__*/React.createElement(ModuleTile, {
    key: m.label,
    icon: m.icon,
    label: m.label,
    tone: m.tone,
    size: 150,
    onClick: () => m.view && onOpen(m.view)
  })))))));
}
Object.assign(window, {
  Portal
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/portal/Portal.jsx", error: String((e && e.message) || e) }); }

__ds_ns.ChartPanel = __ds_scope.ChartPanel;

__ds_ns.CHART_COLORS = __ds_scope.CHART_COLORS;

__ds_ns.DataTable = __ds_scope.DataTable;

__ds_ns.KpiCard = __ds_scope.KpiCard;

__ds_ns.ModuleTile = __ds_scope.ModuleTile;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.Tooltip = __ds_scope.Tooltip;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Radio = __ds_scope.Radio;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Breadcrumb = __ds_scope.Breadcrumb;

__ds_ns.Tabs = __ds_scope.Tabs;

})();
