/**
 * ./testing 子路径：协议一致性金样（PROTOCOL.md 条款 ↔ 线格式字节/形状）。
 * 供本包客户端一致性套件与 A1 主套件（@nbb-ionet/external-server）共享 —— 避免两份协议真相
 * （A3 任务 3）。仅纯数据 + 纯函数，零 Node / 零第三方依赖。
 */
export { ENVELOPE_GOLDENS, goldenById, type EnvelopeGolden } from './conformance/envelope-goldens.js';
