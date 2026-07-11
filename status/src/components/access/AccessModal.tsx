import { Modal, Button } from 'antd';

interface Props {
  open: boolean;
  title: string;
  subtitle?: string;
  onCancel: () => void;
  onOk: () => void;
  okText: string;
  cancelText?: string;
  width?: number;
  children: React.ReactNode;
  okLoading?: boolean;
}

export default function AccessModal({
  open,
  title,
  subtitle,
  onCancel,
  onOk,
  okText,
  cancelText = '取消',
  width = 720,
  children,
  okLoading,
}: Props) {
  return (
    <Modal
      className="kc-access-modal"
      title={null}
      open={open}
      onCancel={onCancel}
      width={width}
      destroyOnClose
      centered
      footer={null}
    >
      <div className="kc-access-modal__head">
        <h3 className="kc-access-modal__title">{title}</h3>
        {subtitle && <p className="kc-access-modal__subtitle">{subtitle}</p>}
      </div>

      <div className="kc-access-modal__body">{children}</div>

      <div className="kc-access-modal__actions">
        <Button onClick={onCancel}>{cancelText}</Button>
        <Button type="primary" onClick={onOk} loading={okLoading}>{okText}</Button>
      </div>
    </Modal>
  );
}
