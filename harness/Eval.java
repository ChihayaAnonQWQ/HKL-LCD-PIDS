import org.mozilla.javascript.*;
public class Eval {
    public static void main(String[] a) throws Exception {
        Context cx = Context.enter();
        try {
            cx.setLanguageVersion(Context.VERSION_ES6);
            Scriptable scope = new ImporterTopLevel(cx);
            String src = "var i = new java.lang.Integer(5); var l = new java.lang.Long(1234567890123);" +
                "var s = ''; s += 'Number(i)=' + Number(i); s += ' | i*2=' + (i*2);" +
                "s += ' | Number(l)=' + Number(l); s += ' | l*1=' + (l*1);" +
                "s += ' | Math.round(Number(i)*8)=' + Math.round(Number(i)*8);" +
                "s += ' | typeof i=' + (typeof i); s;";
            Object r = cx.evaluateString(scope, src, "t", 1, null);
            System.out.println(Context.toString(r));
            Object r2 = cx.evaluateString(scope, "var o={}; o.x=new java.lang.Integer(7); 'prop=' + Number(o.x) + ' mul=' + (o.x*SS)", "t2", 1, null);
            System.out.println(Context.toString(r2));
        } finally { Context.exit(); }
    }
}
