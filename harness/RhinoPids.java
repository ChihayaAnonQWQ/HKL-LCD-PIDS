import org.mozilla.javascript.Context;
import org.mozilla.javascript.Function;
import org.mozilla.javascript.ImporterTopLevel;
import org.mozilla.javascript.RhinoException;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.ScriptableObject;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

/**
 * Renders one JCM scripted-PIDS frame offline.
 *
 * usage: RhinoPids <prelude.js> <script.js> <scenario.json> [out.png]
 */
public final class RhinoPids {
    public static void main(String[] args) throws Exception {
        if (args.length < 3) {
            System.err.println("usage: RhinoPids <prelude.js> <script.js> <scenario.json> [out.png]");
            System.exit(2);
        }
        File preludeFile = new File(args[0]).getAbsoluteFile();
        File scriptFile = new File(args[1]).getAbsoluteFile();
        File scenarioFile = new File(args[2]).getAbsoluteFile();
        String outPath = args.length > 3
                ? new File(args[3]).getAbsolutePath()
                : scenarioFile.getAbsolutePath().replaceAll("\\.json$", "") + ".png";

        Context cx = Context.enter();
        try {
            cx.setLanguageVersion(Context.VERSION_ES6);
            cx.setOptimizationLevel(-1);
            Scriptable scope = new ImporterTopLevel(cx);
            ScriptableObject.putProperty(scope, "__HARNESS_DIR", preludeFile.getParentFile());
            ScriptableObject.putProperty(scope, "__SCRIPT_PATH", scriptFile.getAbsolutePath());
            cx.evaluateString(scope, read(preludeFile), "prelude.js", 1, null);
            cx.evaluateString(scope, read(scriptFile), "script.js", 1, null);

            Object fn = scope.get("__harnessRun", scope);
            if (!(fn instanceof Function)) {
                throw new IllegalStateException("__harnessRun() not found after evaluating prelude");
            }
            Object result = ((Function) fn).call(cx, scope, scope,
                    new Object[]{scenarioFile.getAbsolutePath(), outPath});
            System.out.println("OK " + Context.toString(result));
        } catch (RhinoException e) {
            System.err.println("RHINO ERROR: " + e.getMessage());
            System.err.println(e.getScriptStackTrace());
            e.printStackTrace();
            System.exit(1);
        } finally {
            Context.exit();
        }
    }

    private static String read(File file) throws IOException {
        return new String(Files.readAllBytes(Paths.get(file.getAbsolutePath())), StandardCharsets.UTF_8);
    }
}
