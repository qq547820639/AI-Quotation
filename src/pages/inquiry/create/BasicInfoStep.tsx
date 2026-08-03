/**
 * 步骤 1：基本信息
 */
import { useState } from 'react';
import { Button, Col, DatePicker, Form, Input, Row, Select, Space, Upload } from 'antd';
import { InboxOutlined, RobotOutlined } from '@ant-design/icons';
import type { FormInstance, UploadProps } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { CURRENCY_OPTIONS, Currency, type InquiryItem } from '@/types';
import { organizations } from '@/mock/users';
import { generateInquiryDescription } from '@/utils/aiService';
import { notifySuccess, notifyError } from '@/utils/confirm';
import {
  INVOICE_OPTIONS,
  PAYMENT_TERM_OPTIONS,
  fileToAttachment,
  formatBytes,
  type BasicInfoForm,
} from './shared';

const { TextArea } = Input;
const { Dragger } = Upload;

interface BasicInfoStepProps {
  form: FormInstance<BasicInfoForm>;
  initialValues: BasicInfoForm;
  onChange: (values: BasicInfoForm) => void;
  disabled?: boolean;
  /** 物料明细（W9 AI 生成询价说明用） */
  items?: InquiryItem[];
}

export default function BasicInfoStep({
  form,
  initialValues,
  onChange,
  disabled,
  items = [],
}: BasicInfoStepProps) {
  const { t } = useTranslation();
  const attachments = Form.useWatch('attachments', form) ?? [];
  const [aiLoading, setAiLoading] = useState(false);

  const uploadProps: UploadProps = {
    multiple: true,
    fileList: (attachments as { id: string; name: string; url: string; size: number }[]).map(
      (a) => ({ uid: a.id, name: a.name, status: 'done' as const, url: a.url, size: a.size }),
    ),
    disabled,
    beforeUpload: (file) => {
      const att = fileToAttachment(file);
      const current = (form.getFieldValue('attachments') as BasicInfoForm['attachments']) ?? [];
      form.setFieldValue('attachments', [...current, att]);
      onChange({ ...form.getFieldsValue(true), attachments: [...current, att] } as BasicInfoForm);
      return false;
    },
    onRemove: (file) => {
      const current = (form.getFieldValue('attachments') as BasicInfoForm['attachments']) ?? [];
      const next = current.filter((a) => a.id !== file.uid);
      form.setFieldValue('attachments', next);
      onChange({ ...form.getFieldsValue(true), attachments: next } as BasicInfoForm);
      return true;
    },
    showUploadList: {
      showRemoveIcon: !disabled,
    },
  };

  return (
    <Form<BasicInfoForm>
      form={form}
      layout="vertical"
      initialValues={initialValues}
      disabled={disabled}
      onValuesChange={(_, all) => onChange(all as BasicInfoForm)}
    >
      <Row gutter={24}>
        <Col xs={24} md={12}>
          <Form.Item
            name="subject"
            label={t('inquiry.create.basic.subject')}
            rules={[{ required: true, message: t('inquiry.create.basic.subjectRequired') }]}
          >
            <Input placeholder={t('inquiry.create.basic.subjectPlaceholder')} maxLength={100} showCount />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="organization"
            label={t('inquiry.create.basic.organization')}
            rules={[{ required: true, message: t('inquiry.create.basic.organizationRequired') }]}
          >
            <Select
              placeholder={t('inquiry.create.basic.organizationPlaceholder')}
              options={organizations.map((o) => ({ label: o, value: o }))}
            />
          </Form.Item>
        </Col>

        <Col xs={24} md={12}>
          <Form.Item
            name="ownerName"
            label={t('inquiry.create.basic.ownerName')}
            rules={[{ required: true, message: t('inquiry.create.basic.ownerRequired') }]}
          >
            <Input placeholder={t('inquiry.create.basic.ownerPlaceholder')} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="currency" label={t('inquiry.create.basic.currency')} rules={[{ required: true }]}>
            <Select
              placeholder={t('inquiry.create.basic.currencyPlaceholder')}
              options={CURRENCY_OPTIONS.map((o) => ({
                label: `${t('enum.currency.' + o.value)}（${o.value}）`,
                value: o.value as Currency,
              }))}
            />
          </Form.Item>
        </Col>

        <Col xs={24} md={12}>
          <Form.Item
            name="deadline"
            label={t('inquiry.create.basic.deadline')}
            rules={[
              { required: true, message: t('inquiry.create.basic.deadlineRequired') },
              {
                validator: (_, value: dayjs.Dayjs | null) => {
                  if (!value) return Promise.resolve();
                  if (value.isBefore(dayjs())) {
                    return Promise.reject(new Error(t('inquiry.create.basic.deadlineMustFuture')));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <DatePicker
              showTime
              style={{ width: '100%' }}
              format="YYYY-MM-DD HH:mm"
              placeholder={t('inquiry.create.basic.deadlinePlaceholder')}
              disabledDate={(d) => d.isBefore(dayjs().startOf('day'))}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="expectedDeliveryDate" label={t('inquiry.create.basic.expectedDeliveryDate')}>
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" placeholder={t('inquiry.create.basic.expectedDeliveryDatePlaceholder')} />
          </Form.Item>
        </Col>

        <Col xs={24} md={12}>
          <Form.Item
            name="deliveryAddress"
            label={t('inquiry.create.basic.deliveryAddress')}
            rules={[{ required: true, message: t('inquiry.create.basic.deliveryAddressRequired') }]}
          >
            <Input placeholder={t('inquiry.create.basic.deliveryAddressPlaceholder')} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="contact"
            label={t('inquiry.create.basic.contact')}
            rules={[{ required: true, message: t('inquiry.create.basic.contactRequired') }]}
          >
            <Input placeholder={t('inquiry.create.basic.contactPlaceholder')} />
          </Form.Item>
        </Col>

        <Col xs={24} md={12}>
          <Form.Item
            name="paymentTerms"
            label={t('inquiry.create.basic.paymentTerms')}
            rules={[{ required: true, message: t('inquiry.create.basic.paymentTermsRequired') }]}
          >
            <Select placeholder={t('inquiry.create.basic.paymentTermsPlaceholder')} options={PAYMENT_TERM_OPTIONS} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="invoiceRequirement" label={t('inquiry.create.basic.invoiceRequirement')}>
            <Select placeholder={t('inquiry.create.basic.invoiceRequirementPlaceholder')} options={INVOICE_OPTIONS} allowClear />
          </Form.Item>
        </Col>

        <Col span={24}>
          <Form.Item
            name="description"
            label={
              <Space>
                <span>{t('inquiry.create.basic.description')}</span>
                <Button
                  type="link"
                  size="small"
                  icon={<RobotOutlined />}
                  loading={aiLoading}
                  disabled={disabled}
                  onClick={async () => {
                    const values = form.getFieldsValue(true) as BasicInfoForm;
                    if (!values.subject) {
                      notifyError(t('inquiry.create.basic.aiSubjectFirst'));
                      return;
                    }
                    setAiLoading(true);
                    try {
                      const text = await generateInquiryDescription({
                        subject: values.subject,
                        items,
                        paymentTerms: values.paymentTerms,
                        deliveryAddress: values.deliveryAddress,
                        expectedDeliveryDate: values.expectedDeliveryDate
                          ? dayjs(values.expectedDeliveryDate).format('YYYY-MM-DD')
                          : undefined,
                      });
                      form.setFieldValue('description', text);
                      onChange({ ...values, description: text } as BasicInfoForm);
                      notifySuccess(t('inquiry.create.basic.aiGenerated'));
                    } catch {
                      notifyError(t('inquiry.create.basic.aiFailed'));
                    } finally {
                      setAiLoading(false);
                    }
                  }}
                >
                  {t('inquiry.create.basic.aiGenerate')}
                </Button>
              </Space>
            }
          >
            <TextArea
              rows={5}
              placeholder={t('inquiry.create.basic.descriptionAiPlaceholder')}
              maxLength={2000}
              showCount
            />
          </Form.Item>
        </Col>

        <Col span={24}>
          <Form.Item name="attachments" label={t('inquiry.create.basic.attachments')}>
            <Dragger {...uploadProps}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">{t('inquiry.create.basic.uploadDragText')}</p>
              <p className="ant-upload-hint">
                {t('inquiry.create.basic.uploadDragHint')}
              </p>
            </Dragger>
          </Form.Item>
          {attachments.length > 0 && (
            <div style={{ marginTop: -8, marginBottom: 8, color: 'var(--color-text-tertiary)', fontSize: 12 }}>
              {t('inquiry.create.basic.attachmentSummary', {
                count: attachments.length,
                size: formatBytes(attachments.reduce((s, a) => s + (a.size || 0), 0)),
              })}
            </div>
          )}
        </Col>
      </Row>
    </Form>
  );
}
