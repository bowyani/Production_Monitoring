export default function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  if (total === 0) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  return (
    <div className="pagination">
      <span>
        {start}–{end} of {total}
      </span>
      {pageCount > 1 && (
        <div className="pagination-controls">
          <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
            ‹ Prev
          </button>
          <span>
            Page {page} of {pageCount}
          </span>
          <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount}>
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}
