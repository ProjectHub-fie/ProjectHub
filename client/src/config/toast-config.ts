export const TOAST_COLORS = {
  success: {
    border: "border-green-500",
    background: "bg-green-600",
    text: "text-white",
  },
  error: {
    border: "border-orange-500",
    background: "bg-orange-600",
    text: "text-white",
  },
};

export const getToastVariantStyles = (variant: "success" | "error") => {
  const colors = TOAST_COLORS[variant];
  return `${colors.border} ${colors.background} ${colors.text} font-medium`;
};
