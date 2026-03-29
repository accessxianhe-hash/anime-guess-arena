import { formatPercent } from "@/lib/utils";

type LeaderboardTableProps = {
  title: string;
  entries: Array<{
    id: string;
    nickname: string;
    score: number;
    correctCount: number;
    answeredCount: number;
    accuracy: number;
    durationMs: number;
  }>;
  emptyLabel: string;
};

export function LeaderboardTable({
  title,
  entries,
  emptyLabel,
}: LeaderboardTableProps) {
  return (
    <section className="table-card">
      <div className="split-header">
        <div>
          <div className="eyebrow">{title}</div>
          <h2 className="section-title">高分冲刺榜</h2>
        </div>
        <p className="muted">按分数优先、用时次优排序</p>
      </div>

      {entries.length === 0 ? (
        <div className="empty-state">{emptyLabel}</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>排名</th>
                <th>昵称</th>
                <th>分数</th>
                <th>答对</th>
                <th>正确率</th>
                <th>用时</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr key={entry.id}>
                  <td>
                    <span className={`rank-badge rank-${Math.min(index + 1, 4)}`}>#{index + 1}</span>
                  </td>
                  <td>{entry.nickname}</td>
                  <td>{entry.score}</td>
                  <td>
                    {entry.correctCount}/{entry.answeredCount}
                  </td>
                  <td>{formatPercent(entry.accuracy)}</td>
                  <td>{(entry.durationMs / 1000).toFixed(1)} 秒</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
