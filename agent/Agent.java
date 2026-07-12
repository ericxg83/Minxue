import java.lang.instrument.ClassFileTransformer;
import java.lang.instrument.Instrumentation;
import java.security.ProtectionDomain;

/**
 * Java agent that patches PipeImpl.createListener(boolean) to always use TCP
 * instead of Unix Domain Sockets on Windows.
 *
 * The pattern we patch: aconst_null(0x01) astore_1(0x4C) iload_0(0x1A)
 * -> aconst_null(0x01) astore_1(0x4C) iconst_0(0x03)
 *
 * Actually, we just change iload_0 to iconst_0, which makes the method
 * always evaluate to "false" for the useUDS check, falling through to TCP.
 */
public class Agent {
    public static void premain(String args, Instrumentation inst) {
        System.err.println("[Agent] PipeFixAgent loaded!");
        inst.addTransformer(new ClassFileTransformer() {
            @Override
            public byte[] transform(ClassLoader loader, String className,
                    Class<?> classBeingRedefined, ProtectionDomain protectionDomain,
                    byte[] classfileBuffer) {
                if (!"sun/nio/ch/PipeImpl".equals(className)) return null;
                System.err.println("[Agent] Transforming PipeImpl, class bytes length: " + classfileBuffer.length);

                // Pattern: aconst_null(0x01) astore_1(0x4C) iload_0(0x1A)
                byte[] find = {0x01, 0x4C, (byte)0x1A};
                // Replacement: aconst_null(0x01) astore_1(0x4C) iconst_0(0x03)
                byte[] replace = {0x01, 0x4C, 0x03};

                int count = 0;
                for (int i = 0; i <= classfileBuffer.length - find.length; i++) {
                    boolean match = true;
                    for (int j = 0; j < find.length; j++) {
                        if (classfileBuffer[i + j] != find[j]) { match = false; break; }
                    }
                    if (match) {
                        System.err.println("[Agent] Found pattern at offset " + i);
                        System.arraycopy(replace, 0, classfileBuffer, i, replace.length);
                        count++;
                        i += replace.length - 1;
                    }
                }
                System.err.println("[Agent] PipeImpl: patched " + count + " occurrence(s)");
                return classfileBuffer;
            }
        });
    }
}
