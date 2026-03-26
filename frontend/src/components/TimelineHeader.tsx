interface TimelineHeaderProps {
  count: number;
}

export const TimelineHeader = ({ count }: TimelineHeaderProps) => {
  return (
    <div style={styles.wrap}>
      <div style={styles.title}>笔记（{count}）</div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    margin: '8px 0 12px',
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: '#999',
  },
};
