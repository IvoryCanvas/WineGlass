/* A narrow Wine compatibility shim. This does not emulate a pointer device.
 * All other exports are forwarded to Wine's USER32 by the generated .def file.
 * Missing pointer-device support is reported using the documented failure path.
 */
__declspec(dllimport) void __stdcall SetLastError(unsigned long error);

int __stdcall DllMain(void *module, unsigned long reason, void *reserved) {
    (void)module; (void)reason; (void)reserved;
    return 1;
}

int __stdcall GetPointerDevice(void *device, void *device_info) {
    (void)device; (void)device_info;
    SetLastError(120); /* ERROR_CALL_NOT_IMPLEMENTED */
    return 0;
}
