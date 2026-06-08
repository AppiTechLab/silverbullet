interface BreadcrumbsProps {
  pageName: string;
  onNavigate: (page: string) => void;
}

export function Breadcrumbs({ pageName, onNavigate }: BreadcrumbsProps) {
  const segments = pageName.split("/");
  if (segments.length <= 1) return null;

  return (
    <div id="sb-breadcrumbs">
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        const path = segments.slice(0, i + 1).join("/");
        return (
          <span key={path}>
            {i > 0 && <span className="sb-breadcrumb-sep">›</span>}
            {isLast
              ? <span className="sb-breadcrumb-current">{seg}</span>
              : (
                <span
                  className="sb-breadcrumb-link"
                  onClick={() => onNavigate(path)}
                  role="link"
                >
                  {seg}
                </span>
              )}
          </span>
        );
      })}
    </div>
  );
}
