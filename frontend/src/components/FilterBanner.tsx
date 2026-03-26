interface FilterBannerProps {
  label: string;
}

export const FilterBanner = ({ label }: FilterBannerProps) => {
  return <div style={styles.banner}>{label}</div>;
};

const styles: Record<string, React.CSSProperties> = {
  banner: {
    padding: '14px 18px',
    borderRadius: 14,
    background: '#e9fff0',
    color: '#39a45d',
    marginBottom: 20,
    fontWeight: 600,
  },
};
