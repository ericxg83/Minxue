export default function EmptyState({
  icon: Icon,
  iconSize = 36,
  title,
  description,
  iconStyle,
  iconContainerStyle,
  titleStyle,
  descriptionStyle,
  className = '',
  children,
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${className}`}>
      {Icon &&
        (iconContainerStyle ? (
          <div
            className="flex items-center justify-center"
            style={iconContainerStyle}
          >
            <Icon size={iconSize} style={{ color: 'var(--border)', ...iconStyle }} />
          </div>
        ) : (
          <Icon
            size={iconSize}
            className="mx-auto"
            style={{ color: 'var(--border)', ...iconStyle }}
          />
        ))}
      {title && (
        <p className="mt-3" style={{ fontSize: 'var(--fs-13)', color: 'var(--text-secondary)', ...titleStyle }}>
          {title}
        </p>
      )}
      {description && (
        <p className="mt-0.5" style={{ fontSize: 'var(--fs-11)', color: 'var(--border)', ...descriptionStyle }}>
          {description}
        </p>
      )}
      {children}
    </div>
  )
}
