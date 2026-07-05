export const defaultTablePagination = {
  defaultPageSize: 10,
  showSizeChanger: true,
  pageSizeOptions: [10, 20, 50, 100],
  showTotal: (total: number) => `共 ${total} 条`,
};

export const documentsTablePagination = {
  ...defaultTablePagination,
  showQuickJumper: true,
};
